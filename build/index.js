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
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const utils_1 = require("./utils");
const cors_1 = __importDefault(require("cors"));
const body_parser_1 = __importDefault(require("body-parser"));
dotenv_1.default.config();
const app = (0, express_1.default)();
// Middleware to parse JSON bodies
app.use(express_1.default.json());
app.use((0, cors_1.default)());
app.use(body_parser_1.default.json());
app.use(body_parser_1.default.urlencoded({ extended: true }));
app.get("/", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    return res.status(200).json({
        message: "All Ok!",
    });
}));
app.post("/generate-video", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Parse the request body
        const requestBody = req.body;
        // Validate required fields
        if (!requestBody.id ||
            !requestBody.clips ||
            !requestBody.elevenlabs_voice_id) {
            return res.status(400).json({
                message: "Missing required fields in request body.",
            });
        }
        console.log("Starting Audio & Captions Generation!");
        // Process all scenes concurrently
        const updatedScenes = yield Promise.all(requestBody.clips.map((scene) => __awaiter(void 0, void 0, void 0, function* () {
            // Skip scenes without audio_text
            if (!scene.audio_text)
                return scene;
            // Generate audio using ElevenLabs
            const audioBuffer = yield (0, utils_1.generateElevenLabsAudio)({
                elevenlabs_voice_id: requestBody.elevenlabs_voice_id,
                elevenlabs_stability: requestBody.elevenlabs_stability,
                elevenlabs_similarity: requestBody.elevenlabs_similarity,
                audio_text: scene.audio_text,
                lang_code: requestBody.lang_code,
            });
            console.log("Uploading to S3...");
            // Upload audio to S3
            const audioUrl = yield (0, utils_1.uploadToS3)(audioBuffer, requestBody.id);
            console.log(`Uploaded audio for scene: ${audioUrl}`);
            // Transcribe audio using AssemblyAI (or any transcription service)
            const captions = yield (0, utils_1.transcribeAudio)(audioUrl);
            console.log(`Generated captions for scene: ${JSON.stringify(captions)}`);
            // Return updated scene with audio URL and captions
            return Object.assign(Object.assign({}, scene), { audio_url: audioUrl, captions: captions || [] });
        })));
        console.log("Audio & Captions generated Successfully!");
        // Construct the final payload for video generation
        const videoArgs = Object.assign(Object.assign({}, requestBody), { scenes: updatedScenes });
        // Generate the video
        const videoUrl = yield (0, utils_1.generateVideo)(videoArgs);
        console.log("Video Generated Successfully");
        return res.status(200).json({
            id: requestBody.id,
            video_url: videoUrl,
        });
    }
    catch (error) {
        console.error("Error processing request:", error);
        return res.status(500).json({
            message: "Internal Server Error",
        });
    }
}));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
//# sourceMappingURL=index.js.map