import { z } from "zod";

export interface Clip {
  media_url: string;
  media_type?: "image" | "video";
  duration?: number; // in seconds, optional since it can be calculated for videos, mandatory for images and if whole video audio is used
  video_volume?: number; // Ensure volume is between 0 and 1
  sound_effect_url?: string;
  sound_effect_volume?: number; // Ensure volume is between 0 and 1
  tts_enabled?: boolean; // Flag to indicate if TTS is enabled
  random_sequence?: boolean; // Flag to indicate if the scene should be in random sequence
  subtitle_style?: number;
  title?: string;
  emoji?: string;
  audio_text?: string;
  seconds?: number;
  zoom?: number;
}

export interface PostRequestBody {
  lang_code: "fr" | "en" | "es" | string; // Language code (ISO 639-1)
  id: string;
  elevenlabs_voice_id: string;
  elevenlabs_stability: number;
  elevenlabs_similarity: number;
  elevenlabs_speed?: number;
  elevenlabs_style?: number;
  elevenlabs_use_speaker_boost?: boolean;
  elevenlabs_model_id?: string;
  audio_volume?: number; // Ensure volume is between 0 and 1

  music_url?: string; // Empty string if no music
  music_volume?: number; // Ensure volume is between 0 and 1
  title_style?: number; // Preset of 5 styles (1-5)
  subtitle_style?: number; // Preset of 5 styles (1-5)
  subtitlesonoff?: boolean; // Enable or disable subtitles
  title_y_position?: number;
  subtitle_y_position?: number;
  title_x_position?: number;
  subtitle_x_position?: number;
  title_size?: number;
  subtitle_size?: number;
  subtitle_text_color?: string;
  subtitle_background_color?: string;
  title_text_color?: string;
  title_background_color?: string;
  secondary_color?: string; // Optional secondary color
  audio_text?: string; // audio for whole video, audio_text here overrides audio_text in scenes if both are present
  audio_url?: string; // to get the audio url of the whole video after generating it
  captions?: CaptionType[]; // captions for whole video if audio_text for whole video is used
  clips: Clip[];

  // output video configurations like size, compression, quality
  scale?: number; // Scale factor for the output video (e.g., 1 for original size, 0.5 for half size) default is 1
  fps?: number; // Frames per second for the output video (default is 30)
  crf?: number; // Constant Rate Factor for video quality (lower is better quality, range 0-51) default is 18
  image_format?: "jpeg" | "png"; // Image format for video frames (default is "jpeg")
  codec?: "h264" | "h265" | "vp8" | "vp9" | "mp3" | "aac" | "wav" | "gif" | "prores"; // Video codec to use (default is "h264")
}

export interface AudioParams {
  elevenlabs_voice_id: string;
  elevenlabs_stability: number;
  elevenlabs_similarity: number;
  audio_text: string;
  lang_code: string;
  elevenlabs_speed?: number;
  elevenlabs_style?: number;
  elevenlabs_use_speaker_boost?: boolean;
  elevenlabs_model_id?: string;
}

// Caption Schema
export const CaptionSchema = z
  .object({
    text: z.string(),
    start: z.number().nonnegative(), // Ensure non-negative start time
    end: z.number().nonnegative(), // Ensure non-negative end time
  })
  .refine((data) => data.end > data.start, {
    message: "End time must be greater than start time",
    path: ["end"],
  });

// Scene Schema
export const SceneSchema = z.object({
  duration: z.number().optional(), // added in the calculate metadata // optional so that it does not requir a default value
  media_url: z.string().url(), // Ensure valid URL
  media_type: z.enum(["image", "video"]).default("video").optional(),
  video_volume: z.number().optional(), // Ensure volume is between 0 and 1
  sound_effect_url: z.string().url().optional(),
  sound_effect_volume: z.number().optional(), // Ensure volume is between 0 and 1
  subtitle_style: z.number().optional(),
  title: z.string().optional(),
  emoji: z.string().optional(),
  audio_url: z.string().url().optional(),
  seconds: z.number().positive().optional(), // Ensure positive number if provided // audio seconds if audio_url is null or if tts_enabled is false
  tts_enabled: z.boolean().optional(), // Flag to indicate if TTS is enabled
  random_sequence: z.boolean().optional(), // Flag to indicate if the scene should be in random sequence
  captions: z.array(CaptionSchema).optional(),
  zoom: z.number().optional(),
});

// GenerateVideoArgs Schema
export const GenerateVideoArgsSchema = z
  .object({
    id: z.string(),
    // lang_code: z.string().min(2).max(5), // Ensure valid language code length
    music_url: z.string().url().optional(),
    music_volume: z.number().optional(), // Ensure volume is between 0 and 1
    title_style: z.number().optional(),
    subtitle_style: z.number().optional(),
    subtitlesonoff: z.boolean().optional(),
    title_y_position: z.number().optional(),
    title_x_position: z.number().optional(),
    subtitle_y_position: z.number().optional(),
    subtitle_x_position: z.number().optional(),
    title_size: z.number().optional(),
    subtitle_size: z.number().optional(),
    subtitle_text_color: z.string().optional(), // Could use regex for HEX color validation
    subtitle_background_color: z.string().optional(), // Could use regex for HEX color validation
    title_text_color: z.string().optional(), // Could use regex for HEX color validation
    title_background_color: z.string().optional(), // Could use regex for HEX color validation
    secondary_color: z.string().optional(), // Could use regex for HEX color validation
    scenes: z.array(SceneSchema),
    audio_url: z.string().optional(), // audio for whole video, audio_text here overrides audio_text in scenes if both are present
    captions: z.array(CaptionSchema).optional(), // captions for whole video if audio_text for whole video is used
  })
  .passthrough(); // Allows additional properties

// TypeScript Type from Zod Schema
export type GenerateVideoArgs = z.infer<typeof GenerateVideoArgsSchema>;
export type SceneType = z.infer<typeof SceneSchema>;
export type CaptionType = z.infer<typeof CaptionSchema>;
