import { Composition, CalculateMetadataFunction } from "remotion";
import { z } from "zod";
import { COMP_NAME, CompositionProps, defaultMyCompProps } from "../../types/constants";
import episode from "../episode.json";
import { Main } from "./MyComp/Main";
import { NextLogo } from "./MyComp/NextLogo";

const calculateMetadata: CalculateMetadataFunction<z.infer<typeof CompositionProps>> = ({ props }) => {
  return {
    durationInFrames: props.meta?.durationInFrames || 1200,
    fps: props.meta?.fps || 30,
    width: props.meta?.resolution?.width || 1080,
    height: props.meta?.resolution?.height || 1920,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id={COMP_NAME}
        component={Main}
        durationInFrames={episode.meta.durationInFrames || 1200}
        fps={episode.meta.fps || 30}
        width={episode.meta.resolution.width || 1080}
        height={episode.meta.resolution.height || 1920}
        schema={CompositionProps}
        defaultProps={{ ...defaultMyCompProps, ...episode } as any}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="NextLogo"
        component={NextLogo}
        durationInFrames={300}
        fps={30}
        width={140}
        height={140}
        defaultProps={{
          outProgress: 0,
        }}
      />
    </>
  );
};
