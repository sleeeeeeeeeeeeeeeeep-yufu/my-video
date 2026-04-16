import { z } from "zod";

export const COMP_NAME = "MyComp";

export const CompositionProps = z.object({
  version: z.string().default("2.0.0"),
  template: z.string().default("educational-short-v1"),
  meta: z.object({
    title: z.string().default(""),
    fps: z.number().default(30),
    durationInFrames: z.number().default(1200),
    resolution: z.object({
      width: z.number().default(1080),
      height: z.number().default(1920),
    }).default({ width: 1080, height: 1920 }),
  }).default({ title: "", fps: 30, durationInFrames: 1200, resolution: { width: 1080, height: 1920 } }),
  theme: z.object({
    fontFamily: z.string().default("Inter"),
    mainTextColor: z.string().default("#FFFFFF"),
    strokeColor: z.string().default("#63BFA0"),
    strokeWidth: z.number().default(20),
    titleTextColor: z.string().default("#007873"),
    titleBgColor: z.string().default("#FFFFFF"),
    titleFontSize: z.number().default(48),
    captionFontSize: z.number().default(72),
  }).default({
    fontFamily: "Inter",
    mainTextColor: "#FFFFFF",
    strokeColor: "#63BFA0",
    strokeWidth: 20,
    titleTextColor: "#007873",
    titleBgColor: "#FFFFFF",
    titleFontSize: 48,
    captionFontSize: 72,
  }),
  audio: z.object({
    bgm: z.string().nullable().default(null),
    bgmVolume: z.number().default(0.1),
  }).default({ bgm: null, bgmVolume: 0.1 }),
  fixedTitle: z.string().default(""),
  videoSrc: z.string().default(""),
  segments: z.array(
    z.object({
      id: z.number().default(0),
      type: z.enum(["hook", "normal", "emphasis", "relief", "fact", "conclusion"]).default("normal"),
      start: z.number(),
      end: z.number(),
      text: z.string(),
      animation: z.enum(["pop", "reveal", "instant"]).default("pop"),
      position: z.enum(["bottom", "center"]).default("bottom"),
      zoom: z.number().default(1.0),
      zoomX: z.number().default(0.0),
      zoomY: z.number().default(0.0),
      se: z.string().default("none"),
      highlight: z.boolean().default(false),
      color: z.enum(["white", "green", "red"]).default("white"),
    })
  ).default([]),
  cuts: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
    })
  ).default([]),
  timeline: z.array(
    z.object({
      originalStart: z.number(),
      originalEnd: z.number(),
      newStart: z.number(),
      duration: z.number(),
    })
  ).default([]),
});

export const defaultMyCompProps: z.infer<typeof CompositionProps> = {
  version: "2.0.0",
  template: "educational-short-v1",
  meta: {
    title: "",
    fps: 30,
    durationInFrames: 1200,
    resolution: { width: 1080, height: 1920 },
  },
  theme: {
    fontFamily: "sans-serif",
    mainTextColor: "#FFFFFF",
    strokeColor: "#63BFA0",
    strokeWidth: 20,
    titleTextColor: "#007873",
    titleBgColor: "#FFFFFF",
    titleFontSize: 48,
    captionFontSize: 72,
  },
  audio: {
    bgm: null,
    bgmVolume: 0.1,
  },
  fixedTitle: "",
  videoSrc: "",
  segments: [],
  cuts: [],
  timeline: [],
};

export const DURATION_IN_FRAMES = 1200;
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;
