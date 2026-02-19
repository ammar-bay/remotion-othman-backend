"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerateVideoArgsSchema = exports.SceneSchema = exports.CaptionSchema = void 0;
const zod_1 = require("zod");
// Caption Schema
exports.CaptionSchema = zod_1.z
    .object({
    text: zod_1.z.string(),
    start: zod_1.z.number().nonnegative(), // Ensure non-negative start time
    end: zod_1.z.number().nonnegative(), // Ensure non-negative end time
})
    .refine((data) => data.end > data.start, {
    message: "End time must be greater than start time",
    path: ["end"],
});
// Scene Schema
exports.SceneSchema = zod_1.z.object({
    duration: zod_1.z.number().optional(), // added in the calculate metadata // optional so that it does not requir a default value
    video_url: zod_1.z.string().url(), // Ensure valid URL
    sound_effect_url: zod_1.z.string().url().optional(),
    subtitle_style: zod_1.z.number().optional(),
    title: zod_1.z.string().optional(),
    emoji: zod_1.z.string().optional(),
    audio_url: zod_1.z.string().url().optional(),
    // audio_text: z.string().url().optional(),
    captions: zod_1.z.array(exports.CaptionSchema).optional(),
    seconds: zod_1.z.number().positive().optional(), // Ensure positive number if provided
});
// GenerateVideoArgs Schema
exports.GenerateVideoArgsSchema = zod_1.z
    .object({
    // id: z.string(),
    // lang_code: z.string().min(2).max(5), // Ensure valid language code length
    music_url: zod_1.z.string().url().optional(),
    title_style: zod_1.z.number().optional(),
    subtitle_style: zod_1.z.number().optional(),
    subtitlesonoff: zod_1.z.boolean().optional(),
    title_y_position: zod_1.z.number().optional(),
    title_x_position: zod_1.z.number().optional(),
    subtitle_y_position: zod_1.z.number().optional(),
    subtitle_x_position: zod_1.z.number().optional(),
    title_size: zod_1.z.number().optional(),
    subtitle_size: zod_1.z.number().optional(),
    subtitle_text_color: zod_1.z.string().optional(), // Could use regex for HEX color validation
    subtitle_background_color: zod_1.z.string().optional(), // Could use regex for HEX color validation
    title_text_color: zod_1.z.string().optional(), // Could use regex for HEX color validation
    title_background_color: zod_1.z.string().optional(), // Could use regex for HEX color validation
    scenes: zod_1.z.array(exports.SceneSchema),
})
    .passthrough(); // Allows additional properties
//# sourceMappingURL=types.js.map