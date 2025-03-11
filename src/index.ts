import dotenv from "dotenv";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  PostRequestBody,
  SceneType,
  CaptionType,
  GenerateVideoArgs,
  Clip,
} from "./types";
import {
  generateElevenLabsAudio,
  uploadToS3,
  transcribeAudio,
  generateVideo,
} from "./utils";

dotenv.config();

export const handler = async (
  // event: any
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Parse the request body
    const requestBody: PostRequestBody = JSON.parse(event.body || "{}");

    // Validate required fields
    if (
      !requestBody.id ||
      !requestBody.clips ||
      !requestBody.elevenlabs_voice_id
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Missing required fields in request body.",
        }),
      };
    }

    // console.log("Received request:", JSON.stringify(requestBody, null, 2));

    console.log("Starting Audio & Captions Generation!");

    // Process all scenes concurrently
    const updatedScenes = await Promise.all(
      requestBody.clips.map(async (scene: Clip) => {
        // Skip scenes without audio_text
        if (!scene.audio_text) return scene;

        // Generate audio from ElevenLabs
        const audioBuffer = await generateElevenLabsAudio({
          elevenlabs_voice_id: requestBody.elevenlabs_voice_id,
          elevenlabs_stability: requestBody.elevenlabs_stability,
          elevenlabs_similarity: requestBody.elevenlabs_similarity,
          audio_text: scene.audio_text,
          lang_code: requestBody.lang_code,
        });

        console.log("Uploading to S3...");

        // Upload audio to S3
        const audioUrl = await uploadToS3(audioBuffer, requestBody.id);
        console.log(`Uploaded audio for scene: ${audioUrl}`);

        // Transcribe audio using AssemblyAI
        const captions: CaptionType[] | null = await transcribeAudio(audioUrl);
        console.log(
          `Generated captions for scene: ${JSON.stringify(captions)}`
        );

        // Return updated scene with audio URL and captions
        return {
          ...scene,
          audio_url: audioUrl,
          captions: captions || [],
        };
      })
    );

    console.log("Audio & Captions generated Successfully!");

    // Construct final payload for video generation
    const videoArgs: GenerateVideoArgs = {
      ...requestBody,
      scenes: updatedScenes,
    };

    // console.log("Final video args:", JSON.stringify(videoArgs, null, 2));

    // Generate video
    const videoUrl = await generateVideo(videoArgs);

    console.log("Video Generated Successfully");

    return {
      statusCode: 200,
      body: JSON.stringify({
        id: requestBody.id,
        video_url: videoUrl,
      }),
    };
  } catch (error) {
    console.error("Error processing request:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Internal Server Error",
        // error: error.message,
      }),
    };
  }
};

// handler(
//   {
//   lang_code: "en", // dont need it here
//   id: "unique_video_id",
//   music_url:
//     "https://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Sevish_-__nbsp_.mp3",
//   title_style: 3,
//   subtitle_style: 3,
//   subtitlesonoff: true,
//   title_y_position: 100,
//   title_x_position: 0,
//   subtitle_y_position: 300,
//   subtitle_x_position: -50,
//   title_size: 100,
//   subtitle_size: 80,
//   subtitle_text_color: "#fff", // sub fill color
//   subtitle_background_color: "orange", // sub background color
//   title_text_color: "#000", // title text color
//   title_background_color: "transparent", // title background color
//   elevenlabs_similarity: 0.5,
//   elevenlabs_stability: 0.5,
//   elevenlabs_voice_id: "JBFqnCBsd6RMkjVDRZzb",
//   clips: [
//     {
//       video_url: "https://mfah-tv.s3.amazonaws.com/assets/news.mp4",
//       title: "Ammar Ibrahim",
//       audio_text: "Hello, my name is Ammar Ibrahim.",
//     },
//     {
//       video_url: "https://mfah-tv.s3.amazonaws.com/assets/football.mp4",
//       title: "Football",
//       audio_text: "I love playing football!",
//     },
//     {
//       video_url: "https://mfah-tv.s3.amazonaws.com/assets/football.mp4",
//       title: "Football",
//       audio_text: "My favourite player is Ronaldo!",
//     },
//   ],
// };
// );
