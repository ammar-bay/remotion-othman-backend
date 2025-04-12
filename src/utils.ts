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
import { CaptionType, ElevenLabsParams, GenerateVideoArgs } from "./types";

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

export const generateElevenLabsAudio = async ({
  elevenlabs_voice_id,
  elevenlabs_stability,
  elevenlabs_similarity,
  audio_text,
  lang_code,
  elevenlabs_speed = 1,
}: ElevenLabsParams): Promise<Buffer> => {
  try {
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
        },
      }
    );

    console.log("Stream to Buffer");

    // trimSilence
    const audioBuffer = await trimSilence(audioStream);

    return audioBuffer;
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
 * Transcribes an audio file using AssemblyAI.
 * @param {string} audioUrl - The URL of the audio file to transcribe.
 * @returns {Promise<string | null>} - The transcribed text or null if an error occurs.
 */
export const transcribeAudio = async (
  audioUrl: string
): Promise<CaptionType[] | null> => {
  try {
    const client = new AssemblyAI({
      apiKey: process.env.ASSEMBLYAI_API_KEY as string,
    });

    const transcript = await client.transcripts.transcribe({
      audio_url: audioUrl,
      // language_code: "en_us",
      language_detection: true,
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
  inputProps: GenerateVideoArgs
): Promise<boolean | null> {
  try {
    const composition = process.env.REMOTION_COMPOSITION_ID || "MyCompostion";

    // console.log(inputProps);

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
      codec: "h264",
      functionName: process.env.REMOTION_LAMBDA_FUNCTION_NAME || "",
      outName: `${inputProps.id}.mp4`,
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
export const trimSilence = async (audioStream: Readable): Promise<Buffer> => {
  try {
    const tempFile = path.join(
      tmpdir(),
      `input-${Date.now()}-${Math.random()}.mp3`
    );
    const outputFile = path.join(
      tmpdir(),
      `output-${Date.now()}-${Math.random()}.mp3`
    );

    // Save the stream to a temporary file
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(tempFile);
      audioStream.pipe(writeStream);
      audioStream.on("end", resolve);
      audioStream.on("error", reject);
    });

    console.log("Audio saved, analyzing silence...");

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
      const audioBuffer = await fs.readFile(tempFile);
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
      const audioBuffer = await fs.readFile(tempFile);
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

    // Clean up temporary files
    await fs.remove(tempFile);
    await fs.remove(outputFile);

    return trimmedBuffer;
  } catch (error) {
    console.error("Error trimming silence:", error);
    // convert audioStream to buffer and return without trimming
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      audioStream
        .on("data", (chunk) => {
          chunks.push(chunk);
        })
        .on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve(buffer);
        })
        .on("error", (err) => {
          console.error("Error reading audio stream:", err);
          reject(err);
        });
    });
    //     ///
    //     const chunks: Buffer[] = [];
    //
    //     for await (const chunk of audioStream) {
    //       chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    //     }
    //
    //     return Buffer.concat(chunks);
    //     ///
  }
};
