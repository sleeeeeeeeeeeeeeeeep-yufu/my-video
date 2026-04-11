import { z } from "zod";
import { COMP_NAME, CompositionProps } from "../../types/constants";
import { useRendering } from "../helpers/use-rendering";
import { AlignEnd } from "./AlignEnd";
import { InputContainer } from "./Container";
import { DownloadButton } from "./DownloadButton";
import { ErrorComp } from "./Error";
import { Input } from "./Input";
import { ProgressBar } from "./ProgressBar";
import { Spacing } from "./Spacing";

export const RenderControls: React.FC<{
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  inputProps: z.infer<typeof CompositionProps>;
  originalFileName?: string;
}> = ({ text, setText, inputProps, originalFileName }) => {
  const { renderMedia, state, undo } = useRendering(COMP_NAME, inputProps, originalFileName);

  return (
    <InputContainer>
      {state.status === "init" ||
      state.status === "invoking" ||
      state.status === "error" ? (
        <>
          <div className="text-sm text-gray-500 mb-2">タイトル</div>
          <Input
            disabled={state.status === "invoking"}
            setText={setText}
            text={text}
          ></Input>
          <Spacing></Spacing>
          <AlignEnd>
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-blue-200 disabled:cursor-not-allowed transition-colors shadow-sm"
              disabled={state.status === "invoking"}
              onClick={renderMedia}
            >
              {state.status === "invoking" ? "送信中..." : "Render video"}
            </button>
          </AlignEnd>
          {state.status === "error" ? (
            <ErrorComp message={state.error.message}></ErrorComp>
          ) : null}
        </>
      ) : null}
      {state.status === "rendering" || state.status === "done" ? (
        <>
          <ProgressBar
            progress={state.status === "rendering" ? state.progress : 1}
          />
          <Spacing></Spacing>
          <AlignEnd>
            <DownloadButton undo={undo} state={state}></DownloadButton>
          </AlignEnd>
        </>
      ) : null}
    </InputContainer>
  );
};
