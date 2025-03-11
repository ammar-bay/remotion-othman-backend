"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcribeAudio = exports.uploadToS3 = exports.generateElevenLabsAudio = void 0;
exports.generateVideo = generateVideo;
exports.getRenderProgressStatus = getRenderProgressStatus;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_1 = require("@remotion/lambda/client");
const assemblyai_1 = require("assemblyai");
const elevenlabs_1 = require("elevenlabs");
const dotenv_1 = __importDefault(require("dotenv"));
const consumers_1 = require("stream/consumers");
dotenv_1.default.config();
/**
 * Converts a Readable stream to a Buffer
 * @param stream Readable stream from ElevenLabs API
 * @returns Promise<Buffer>
 */
const generateElevenLabsAudio = (_a) => __awaiter(void 0, [_a], void 0, function* ({ elevenlabs_voice_id, elevenlabs_stability, elevenlabs_similarity, audio_text, lang_code, }) {
    try {
        const client = new elevenlabs_1.ElevenLabsClient({
            apiKey: process.env.ELEVENLABS_API_KEY,
        });
        const audioStream = yield client.textToSpeech.convert(elevenlabs_voice_id, {
            output_format: "mp3_44100_128",
            text: audio_text,
            model_id: "eleven_multilingual_v2",
            // language_code: lang_code,
            // voice_settings: {
            //   stability: elevenlabs_stability,
            //   similarity_boost: elevenlabs_similarity,
            // },
        });
        console.log("Stream to Buffer");
        // Convert the stream to a Buffer using the built-in method
        const audioBuffer = yield (0, consumers_1.buffer)(audioStream);
        return audioBuffer;
    }
    catch (error) {
        console.error("Error generating ElevenLabs audio:");
        throw new Error("Failed to generate audio.");
    }
});
exports.generateElevenLabsAudio = generateElevenLabsAudio;
/**
 * Uploads an audio file to AWS S3.
 * @param {Buffer} audioBuffer - The generated audio buffer from ElevenLabs.
 * @returns {Promise<string>} - The S3 URL of the uploaded file.
 */
const uploadToS3 = (audioBuffer, id) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const bucketName = process.env.AWS_BUCKET_NAME;
        if (!bucketName)
            throw new Error("AWS_BUCKET_NAME is not defined in environment variables.");
        const fileName = `${id}_${Date.now()}.mp3`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: fileName,
            Body: audioBuffer,
            ContentType: "audio/mpeg",
        });
        const s3 = new client_s3_1.S3Client({
            region: process.env.AWS_S3_REGION || "us-east-1", // Default to "us-east-1" if not set
            credentials: {
                accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
            },
        });
        yield s3.send(command);
        const fileUrl = `https://${bucketName}.s3.amazonaws.com/${fileName}`;
        console.log(`Audio uploaded successfully: ${fileUrl}`);
        return fileUrl;
    }
    catch (error) {
        console.error("Error uploading audio to S3:", error);
        throw new Error("Failed to upload audio to S3.");
    }
});
exports.uploadToS3 = uploadToS3;
/**
 * Transcribes an audio file using AssemblyAI.
 * @param {string} audioUrl - The URL of the audio file to transcribe.
 * @returns {Promise<string | null>} - The transcribed text or null if an error occurs.
 */
const transcribeAudio = (audioUrl) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const client = new assemblyai_1.AssemblyAI({
            apiKey: process.env.ASSEMBLYAI_API_KEY,
        });
        const transcript = yield client.transcripts.transcribe({
            audio_url: audioUrl,
        });
        if (!transcript.words)
            return null;
        return transcript.words.map((word) => {
            return {
                text: word.text,
                start: word.start,
                end: word.end,
            };
        });
    }
    catch (error) {
        console.error("Error during transcription:", error);
        throw new Error("Error Transcribing");
    }
});
exports.transcribeAudio = transcribeAudio;
/**
 * Generates a video and polls for progress until completion or failure.
 * @param {GenerateVideoArgs} inputProps - The input properties for the render.
 * @returns {Promise<string | null>} - The output file URL or null if failed.
 */
function generateVideo(inputProps) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const composition = process.env.REMOTION_COMPOSITION_ID || "MyCompostion";
            console.log(inputProps);
            // Trigger video rendering on AWS Lambda
            const { bucketName, renderId } = yield (0, client_1.renderMediaOnLambda)({
                region: process.env
                    .REMOTION_LAMBDA_REGION ||
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
                const progress = yield getRenderProgressStatus(bucketName, renderId, process.env.REMOTION_LAMBDA_FUNCTION_NAME || "");
                console.log("Render progress:", progress.overallProgress * 100, "%");
                if (progress.done) {
                    console.log("Rendering completed. Output file:", progress.outputFile);
                    return progress.outputFile || null;
                }
                if (progress.fatalErrorEncountered) {
                    console.error("Fatal error encountered during rendering. Stopping polling.");
                    return null;
                }
                // Wait before polling again (Adjust interval as needed)
                yield new Promise((resolve) => setTimeout(resolve, 5000));
            }
        }
        catch (error) {
            console.error("Error generating video:", error);
            return null;
        }
    });
}
function getRenderProgressStatus(bucketName, renderId, functionName) {
    return __awaiter(this, void 0, void 0, function* () {
        const progress = yield (0, client_1.getRenderProgress)({
            renderId,
            bucketName,
            functionName,
            region: process.env
                .REMOTION_LAMBDA_REGION ||
                "us-east-1",
        });
        return progress;
    });
}
//# sourceMappingURL=utils.js.map