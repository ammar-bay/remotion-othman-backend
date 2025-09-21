import express from "express";
import dotenv from "dotenv";
import {
  generateAudio,
  uploadToS3,
  transcribeAudio,
  generateVideo,
  uploadVideoToS3,
} from "./utils";
import cors from "cors";
import bodyParser from "body-parser";
import { PostRequestBody, GenerateVideoArgs, Clip, CaptionType } from "./types";
import axios from "axios";

dotenv.config();

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", async (req, res) => {
  return res.status(200).json({
    message: "All Ok!",
  });
});

app.post("/generate-video", async (req, res) => {
  try {
    // Parse the request body
    const requestBody: PostRequestBody = req.body;

    // Validate required fields
    if (
      !requestBody.id ||
      !requestBody.clips ||
      !requestBody.elevenlabs_voice_id
    ) {
      return res.status(400).json({
        message: "Missing required fields in request body.",
      });
    }

    console.log("Starting Audio & Captions Generation!");

    let updatedScenes: Clip[] = [];

    if (requestBody.audio_text) {
      // Generate audio using ElevenLabs for the whole video
      const audioBuffer = await generateAudio({
        elevenlabs_voice_id: requestBody.elevenlabs_voice_id,
        elevenlabs_stability: requestBody.elevenlabs_stability,
        elevenlabs_similarity: requestBody.elevenlabs_similarity,
        audio_text: requestBody.audio_text,
        lang_code: requestBody.lang_code,
        elevenlabs_speed: requestBody.elevenlabs_speed,
        elevenlabs_style: requestBody.elevenlabs_style,
        elevenlabs_use_speaker_boost: requestBody.elevenlabs_use_speaker_boost,
      });

      console.log("Uploading full video audio to S3...");

      // Upload audio to S3
      const audioUrl = await uploadToS3(audioBuffer, requestBody.id);
      console.log(`Uploaded full video audio: ${audioUrl}`);

      // Transcribe audio using AssemblyAI (or any transcription service)
      const captions: CaptionType[] | null = await transcribeAudio(
        audioUrl,
        requestBody.lang_code
      );
      console.log(
        `Generated captions for full video: ${JSON.stringify(captions)}`
      );

      // Update the requestBody to include the audio_url for the whole video
      requestBody.audio_url = audioUrl;
      requestBody.captions = captions || [];

      updatedScenes = requestBody.clips.map((scene: Clip) => ({
        ...scene,
        media_type: scene.media_type || "video",
        audio_url: null, // No individual audio URL since full video audio is used
        tts_enabled: scene.tts_enabled || true,
        random_sequence: scene.random_sequence || true,
        captions: null,
      }));
    } else {
      // Process all scenes concurrently
      updatedScenes = await Promise.all(
        requestBody.clips.map(async (scene: Clip) => {
          // Skip scenes without audio_text
          if (!scene.audio_text) return scene;

          // Generate audio using ElevenLabs
          const audioBuffer = await generateAudio({
            elevenlabs_voice_id: requestBody.elevenlabs_voice_id,
            elevenlabs_stability: requestBody.elevenlabs_stability,
            elevenlabs_similarity: requestBody.elevenlabs_similarity,
            audio_text: scene.audio_text,
            lang_code: requestBody.lang_code,
            elevenlabs_speed: requestBody.elevenlabs_speed,
            elevenlabs_style: requestBody.elevenlabs_style,
            elevenlabs_use_speaker_boost:
              requestBody.elevenlabs_use_speaker_boost,
          });

          console.log("Uploading to S3...");

          // Upload audio to S3
          const audioUrl = await uploadToS3(audioBuffer, requestBody.id);
          console.log(`Uploaded audio for scene: ${audioUrl}`);

          // Transcribe audio using AssemblyAI (or any transcription service)
          const captions: CaptionType[] | null = await transcribeAudio(
            audioUrl,
            requestBody.lang_code
          );
          console.log(
            `Generated captions for scene: ${JSON.stringify(captions)}`
          );

          // Return updated scene with audio URL and captions
          return {
            ...scene,
            media_type: scene.media_type || "video",
            audio_url: audioUrl,
            tts_enabled: scene.tts_enabled || true,
            random_sequence: scene.random_sequence || true,
            captions: captions || [],
          };
        })
      );
    }

    console.log("Audio & Captions generated Successfully!");

    // Construct the final payload for video generation
    const videoArgs: GenerateVideoArgs = {
      ...requestBody,
      scenes: updatedScenes,
    };

    // Generate the video
    const videoResult = await generateVideo(videoArgs, requestBody);

    if (videoResult) {
      console.log("Video Triggered Successfully");
      return res.status(200).json({
        message: "Video Triggered Successfully",
      });
    }

    return res.status(200).json({
      message: "There is some error generation video, try again later...",
    });
  } catch (error) {
    console.error("Error processing request:", error);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    if (payload.type === "error") {
      console.error("Error in video processing:", payload);
      await axios.post(process.env.OUTPUT_SERVER_URL || "", payload);
      return res.status(200).send("Error in video processing");
    }
    console.log("WEBHOOK:", payload);

    const videoUrl = payload.outputUrl;
    const videoId = payload.customData?.video_id || "default_id";

    // Process + upload cleaned video to your bucket
    const finalUrl = await uploadVideoToS3(videoUrl, videoId);

    // Send the new URL to your output server
    await axios.post(process.env.OUTPUT_SERVER_URL || "", {
      ...payload,
      outputUrl: finalUrl, // Replace with cleaned video URL
    });

    res.status(200).send("Video processed and forwarded");
  } catch (err) {
    console.error("Error processing webhook:", err);
    await axios.post(process.env.OUTPUT_SERVER_URL || "", {
      type: "error",
      message: "Error processing webhook from backend server",
      details: err,
    });

    res.status(200).send("Error processing webhook");
  }
});

app.post("/webhook-dev", async (req, res) => {
  console.log("DEV WEBHOOK: ", req.body);
  res.status(200).send("Webhook received");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
