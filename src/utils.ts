import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  getRenderProgress,
  renderMediaOnLambda,
  RenderMediaOnLambdaInput,
  RenderProgress,
} from "@remotion/lambda/client";
import { AssemblyAI } from "assemblyai";
import { ElevenLabsClient } from "elevenlabs";
import { Readable } from "stream";
import { CaptionType, ElevenLabsParams, GenerateVideoArgs } from "./types";
import dotenv from "dotenv";
import { buffer } from "stream/consumers";

dotenv.config();

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
        // voice_settings: {
        //   stability: elevenlabs_stability,
        //   similarity_boost: elevenlabs_similarity,
        // },
      }
    );

    console.log("Stream to Buffer");
    // Convert the stream to a Buffer using the built-in method
    const audioBuffer = await buffer(audioStream);
    return audioBuffer;
  } catch (error) {
    console.error("Error generating ElevenLabs audio:");
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
): Promise<string | null> {
  try {
    const composition = process.env.REMOTION_COMPOSITION_ID || "MyCompostion";

    console.log(inputProps);

    // Trigger video rendering on AWS Lambda
    const { bucketName, renderId } = await renderMediaOnLambda({
      region:
        (process.env
          .REMOTION_LAMBDA_REGION as RenderMediaOnLambdaInput["region"]) ||
        "us-east-1",
      composition,
      serveUrl: process.env.REMOTION_SERVE_URL || "",
      inputProps,
      codec: "h264",
      functionName: process.env.REMOTION_LAMBDA_FUNCTION_NAME || "",
      outName: `${inputProps.id}.mp4`,
    });

    // console.log("Video rendering started");
    // console.log("Bucket name:", bucketName);
    // console.log("Render ID:", renderId);

    // Poll for progress
    while (true) {
      const progress = await getRenderProgressStatus(
        bucketName,
        renderId,
        process.env.REMOTION_LAMBDA_FUNCTION_NAME || ""
      );
      console.log("Render progress:", progress.overallProgress * 100, "%");

      if (progress.done) {
        console.log("Rendering completed. Output file:", progress.outputFile);
        return progress.outputFile || null;
      }

      if (progress.fatalErrorEncountered) {
        console.error(
          "Fatal error encountered during rendering. Stopping polling."
        );
        return null;
      }

      // Wait before polling again (Adjust interval as needed)
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
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
