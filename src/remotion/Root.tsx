import { Composition } from "remotion";
import { COMP_NAME, CompositionProps, defaultMyCompProps } from "../../types/constants";
import episode from "../episode.json";
import { Main } from "./MyComp/Main";
import { NextLogo } from "./MyComp/NextLogo";

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
