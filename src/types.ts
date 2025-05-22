import { z } from "zod";

export interface Clip {
  video_url: string;
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
  clips: Clip[];
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
  video_url: z.string().url(), // Ensure valid URL
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
  })
  .passthrough(); // Allows additional properties

// TypeScript Type from Zod Schema
export type GenerateVideoArgs = z.infer<typeof GenerateVideoArgsSchema>;
export type SceneType = z.infer<typeof SceneSchema>;
export type CaptionType = z.infer<typeof CaptionSchema>;
