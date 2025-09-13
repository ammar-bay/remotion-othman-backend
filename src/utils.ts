import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  getRenderProgress,
  renderMediaOnLambda,
  RenderMediaOnLambdaInput,
  RenderProgress,
} from "@remotion/lambda/client";
import { getSilentParts } from "@remotion/renderer";
import { AssemblyAI } from "assemblyai";
import dotenv from "dotenv";
import { ElevenLabsClient } from "elevenlabs";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";
import { tmpdir } from "os";
import path from "path";
import { Readable } from "stream";
import {
  CaptionType,
  AudioParams,
  GenerateVideoArgs,
  PostRequestBody,
} from "./types";
import OpenAI from "openai";
import axios from "axios";

dotenv.config();

const webhook: RenderMediaOnLambdaInput["webhook"] = {
  url: process.env.REMOTION_WEBHOOK_URL || "",
  secret: process.env.REMOTION_WEBHOOK_SECRET || null,
};

/**
 * Converts a Readable stream to a Buffer
 * @param stream Readable stream from ElevenLabs API
 * @returns Promise<Buffer>
 */

export const generateAudio = async ({
  elevenlabs_voice_id,
  elevenlabs_stability,
  elevenlabs_similarity,
  audio_text,
  lang_code,
  elevenlabs_speed = 1,
  elevenlabs_style = 0,
  elevenlabs_use_speaker_boost = false,
}: AudioParams): Promise<Buffer> => {
  try {
    let audioBuffer: Buffer;

    if (lang_code === "he") {
      const openai = new OpenAI();

      const mp3 = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "coral",
        input: audio_text,
        instructions: "Speak in a cheerful and positive tone.",
      });

      audioBuffer = Buffer.from(await mp3.arrayBuffer());
    } else {
      const client = new ElevenLabsClient({
        apiKey: process.env.ELEVENLABS_API_KEY,
      });

      const audioStream: Readable = await client.textToSpeech.convert(
        elevenlabs_voice_id,
        {
          output_format: "mp3_44100_128",
          text: audio_text,
          model_id: "eleven_multilingual_v2",
          // language_code: lang_code,
          voice_settings: {
            stability: elevenlabs_stability,
            similarity_boost: elevenlabs_similarity,
            speed: elevenlabs_speed,
            use_speaker_boost: elevenlabs_use_speaker_boost,
            style: elevenlabs_style,
          },
        }
      );

      console.log("Stream to Buffer");

      // convert stream to buffer
      const chunks: Buffer[] = [];

      for await (const chunk of audioStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      audioBuffer = Buffer.concat(chunks);
    }
    // trimSilence

    try {
      const trimmedBuffer = await trimSilence(audioBuffer);
      return trimmedBuffer;
    } catch (error) {
      console.error("Error trimming silence:", error);
      // If trimming fails, return the original audio buffer
      return audioBuffer;
    }
  } catch (error) {
    console.error("Error generating ElevenLabs audio:", error);
    throw new Error("Failed to generate audio.");
  }
};

/**
 * Uploads an audio file to AWS S3.
 * @param {Buffer} audioBuffer - The generated audio buffer from ElevenLabs.
 * @returns {Promise<string>} - The S3 URL of the uploaded file.
 */
export const uploadToS3 = async (
  audioBuffer: Buffer,
  id: string
): Promise<string> => {
  try {
    const bucketName = process.env.AWS_BUCKET_NAME as string;
    if (!bucketName)
      throw new Error(
        "AWS_BUCKET_NAME is not defined in environment variables."
      );

    const fileName = `${id}_${Date.now()}.mp3`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: audioBuffer,
      ContentType: "audio/mpeg",
    });

    const s3 = new S3Client({
      region: process.env.AWS_S3_REGION || "us-east-1", // Default to "us-east-1" if not set

      credentials: {
        accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY as string,
      },
    });

    await s3.send(command);

    const fileUrl = `https://${bucketName}.s3.amazonaws.com/${fileName}`;
    console.log(`Audio uploaded successfully: ${fileUrl}`);

    return fileUrl;
  } catch (error) {
    console.error("Error uploading audio to S3:", error);
    throw new Error("Failed to upload audio to S3.");
  }
};

/**
 *  Uploads a video file to AWS S3 after cleaning its metadata using ffmpeg.
 * @param {string} videoUrl - The URL of the video file to upload.
 * @param {string} id - A unique identifier for the video.
 * @returns {Promise<string>} - The S3 URL of the uploaded video file.
 */
export const uploadVideoToS3 = async (
  videoUrl: string,
  id: string
): Promise<string> => {
  try {
    const bucketName = process.env.AWS_BUCKET_NAME as string;
    if (!bucketName)
      throw new Error(
        "AWS_BUCKET_NAME is not defined in environment variables."
      );

    const fileName = `${id}_${Date.now()}.mp4`;
    const tempInput = path.join(tmpdir(), `input-${id}.mp4`);
    const tempOutput = path.join(tmpdir(), `output-${id}.mp4`);

    // 1. Download video from Remotion outputUrl
    const response = await axios.get(videoUrl, { responseType: "arraybuffer" });
    fs.writeFileSync(tempInput, response.data);

    // 2. Run ffmpeg to clean/spoof metadata
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempInput)
        .outputOptions([
          "-c copy",
          "-metadata",
          "encoder=Adobe Premiere Pro 23.0 (Windows)",
          "-metadata",
          "software=Adobe Premiere Pro",
          "-metadata",
          "comment=Edited with CapCut",
          "-brand",
          "mp42",
        ])
        .save(tempOutput)
        .on("end", () => resolve())
        .on("error", (err) => reject(err));
    });

    const finalBuffer = fs.readFileSync(tempOutput);

    // 3. Upload to your own S3 bucket
    const s3 = new S3Client({
      region: process.env.AWS_S3_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY as string,
      },
    });

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: finalBuffer,
      ContentType: "video/mp4",
    });

    await s3.send(command);

    const fileUrl = `https://${bucketName}.s3.amazonaws.com/${fileName}`;
    console.log(`Video uploaded successfully: ${fileUrl}`);

    // Cleanup tmp files
    fs.unlinkSync(tempInput);
    fs.unlinkSync(tempOutput);

    return fileUrl;
  } catch (error) {
    console.error("Error uploading video to S3:", error);
    throw new Error("Failed to upload video to S3.");
  }
};

/**
 * Transcribes an audio file using AssemblyAI.
 * @param {string} audioUrl - The URL of the audio file to transcribe.
 * @returns {Promise<string | null>} - The transcribed text or null if an error occurs.
 */
export const transcribeAudio = async (
  audioUrl: string,
  lang_code: string
): Promise<CaptionType[] | null> => {
  try {
    const client = new AssemblyAI({
      apiKey: process.env.ASSEMBLYAI_API_KEY as string,
    });

    const transcript = await client.transcripts.transcribe({
      audio_url: audioUrl,
      language_code: lang_code,
      speech_model: getLanguageValue(lang_code),
      // language_detection: true,
    });

    if (!transcript.words) return null;

    return transcript.words.map((word) => {
      return {
        text: word.text,
        start: word.start,
        end: word.end,
      };
    });
  } catch (error) {
    console.error("Error during transcription:", error);
    throw new Error("Error Transcribing");
  }
};

/**
 * Generates a video and polls for progress until completion or failure.
 * @param {GenerateVideoArgs} inputProps - The input properties for the render.
 * @returns {Promise<string | null>} - The output file URL or null if failed.
 */
export async function generateVideo(
  inputProps: GenerateVideoArgs,
  requestBody: PostRequestBody
): Promise<boolean | null> {
  try {
    const composition = process.env.REMOTION_COMPOSITION_ID || "MyCompostion";

    console.log(inputProps);

    const webhook: RenderMediaOnLambdaInput["webhook"] = {
      url: process.env.REMOTION_WEBHOOK_URL || "",
      secret: process.env.REMOTION_WEBHOOK_SECRET || null,
      customData: {
        video_id: inputProps.id,
      },
    };

    // Trigger video rendering on AWS Lambda
    const { bucketName, renderId } = await renderMediaOnLambda({
      region:
        (process.env
          .REMOTION_LAMBDA_REGION as RenderMediaOnLambdaInput["region"]) ||
        "us-east-1",
      composition,
      webhook,
      serveUrl: process.env.REMOTION_SERVE_URL || "",
      inputProps,
      functionName: process.env.REMOTION_LAMBDA_FUNCTION_NAME || "",
      outName: `${inputProps.id}.mp4`,
      // quality
      codec: requestBody.codec || "h264",
      crf: requestBody.crf || 18,
      imageFormat: "jpeg",
      scale: requestBody.scale || 1,
      jpegQuality: 80,
    });

    return true;

    // console.log("Video rendering started");
    // console.log("Bucket name:", bucketName);
    // console.log("Render ID:", renderId);

    // Poll for progress
    //     while (true) {
    //       const progress = await getRenderProgressStatus(
    //         bucketName,
    //         renderId,
    //         process.env.REMOTION_LAMBDA_FUNCTION_NAME || ""
    //       );
    //       console.log("Render progress:", progress.overallProgress * 100, "%");
    //
    //       if (progress.done) {
    //         console.log("Rendering completed. Output file:", progress.outputFile);
    //         return progress.outputFile || null;
    //       }
    //
    //       if (progress.fatalErrorEncountered) {
    //         console.error(
    //           "Fatal error encountered during rendering. Stopping polling."
    //         );
    //         return null;
    //       }
    //
    //       // Wait before polling again (Adjust interval as needed)
    //       await new Promise((resolve) => setTimeout(resolve, 1000));
    //     }
  } catch (error) {
    console.error("Error generating video:", error);
    return null;
  }
}

export async function getRenderProgressStatus(
  bucketName: string,
  renderId: string,
  functionName: string
): Promise<RenderProgress> {
  const progress = await getRenderProgress({
    renderId,
    bucketName,
    functionName,
    region:
      (process.env
        .REMOTION_LAMBDA_REGION as RenderMediaOnLambdaInput["region"]) ||
      "us-east-1",
  });
  return progress;
}

/**
 * Trims silence from the beginning and end of an audio stream.
 * @param {Readable} audioStream - The input audio stream.
 * @returns {Promise<Buffer>} - A Buffer of the trimmed audio.
 */
export const trimSilence = async (audioBuffer: Buffer): Promise<Buffer> => {
  const tempFile = path.join(
    tmpdir(),
    `input-${Date.now()}-${Math.random().toString(36).substring(2, 10)}.mp3`
  );
  const outputFile = path.join(
    tmpdir(),
    `output-${Date.now()}-${Math.random().toString(36).substring(2, 10)}.mp3`
  );
  try {
    // Save the buffer to a temporary file
    await fs.writeFile(tempFile, audioBuffer);

    console.log("Audio saved to temporary file:", tempFile);

    console.log("Analyzing silence...");

    // Analyze silence in the audio
    const { silentParts, durationInSeconds } = await getSilentParts({
      src: tempFile,
      noiseThresholdInDecibels: -40,
      minDurationInSeconds: 0.1,
    });

    console.log("Silent Parts Detected:", silentParts);

    // If no silence detected, return the original audio as a Buffer
    if (silentParts.length === 0) {
      console.log("No silence detected, returning original audio.");
      await fs.remove(tempFile);
      return audioBuffer;
    }

    let trimStart = 0;
    let trimEnd = durationInSeconds;

    // If there's silence at the start, update trimStart
    if (Math.floor(silentParts[0].startInSeconds) === 0) {
      trimStart = silentParts[0].endInSeconds;
    }

    // If there's silence at the end, update trimEnd
    const lastSilentPart = silentParts[silentParts.length - 1];
    if (lastSilentPart.endInSeconds >= durationInSeconds - 0.1) {
      trimEnd = lastSilentPart.startInSeconds;
    }

    console.log(`Final trim range: Start: ${trimStart}s, End: ${trimEnd}s`);

    // Ensure trimStart is never greater than trimEnd
    if (trimStart >= trimEnd) {
      console.warn("Invalid trim range, returning original audio.");
      await fs.remove(tempFile);
      return audioBuffer;
    }

    // Trim audio using ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(tempFile)
        .setStartTime(trimStart)
        .setDuration(trimEnd - trimStart)
        .output(outputFile)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    console.log("Silence trimmed successfully!");

    // Read the trimmed file as a Buffer
    const trimmedBuffer = await fs.readFile(outputFile);

    return trimmedBuffer;
  } catch (error) {
    console.error("Error trimming silence:", error);
    throw new Error("Failed to trim silence.");
  } finally {
    await fs.remove(tempFile);
    await fs.remove(outputFile);
  }
};

const langMap: Record<string, "best"> = {
  en: "best",
  en_au: "best",
  en_uk: "best",
  en_us: "best",
  es: "best",
  fr: "best",
  de: "best",
  it: "best",
  pt: "best",
  nl: "best",
  hi: "best",
  ja: "best",
  zh: "best",
  fi: "best",
  ko: "best",
  pl: "best",
  ru: "best",
  tr: "best",
  uk: "best",
  vi: "best",
};

function getLanguageValue(langCode: string): "best" | "nano" {
  return langMap[langCode] ?? "nano";
}
