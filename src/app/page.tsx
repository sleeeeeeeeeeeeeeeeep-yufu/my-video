"use client";

import { Player } from "@remotion/player";
import type { NextPage } from "next";
import { useMemo, useState } from "react";
import { z } from "zod";
import { CompositionProps, defaultMyCompProps } from "../../types/constants";
import { RenderControls } from "../components/RenderControls";
import { Spacing } from "../components/Spacing";
import { Tips } from "../components/Tips";
import { Main } from "../remotion/MyComp/Main";
// @ts-ignore
import episode from "../episode.json";

const Home: NextPage = () => {
  const [text, setText] = useState<string>(episode.meta?.title || defaultMyCompProps.meta.title);

  const inputProps: z.infer<typeof CompositionProps> = useMemo(() => {
    return {
      ...(episode as any),
      meta: {
        ...episode.meta,
        title: text,
      }
    };
  }, [text, episode]);

  return (
    <div>
      <div className="max-w-screen-md m-auto mb-5 px-4">
        <div className="overflow-hidden rounded-geist shadow-[0_0_200px_rgba(0,0,0,0.15)] mb-10 mt-16">
          <Player
            component={Main}
            inputProps={inputProps}
            durationInFrames={episode.meta?.durationInFrames || 1200}
            fps={episode.meta?.fps || 30}
            compositionHeight={episode.meta?.resolution?.height || 1920}
            compositionWidth={episode.meta?.resolution?.width || 1080}
            style={{
              width: "100%",
            }}
            controls
            autoPlay
            loop
          />
        </div>
        <RenderControls
          text={text}
          setText={setText}
          inputProps={inputProps}
        ></RenderControls>
        <Spacing></Spacing>
        <Spacing></Spacing>
        <Tips></Tips>
      </div>
    </div>
  );
};

export default Home;
