import {
  AwsRegion,
  renderMediaOnLambda,
  RenderMediaOnLambdaOutput,
  speculateFunctionName,
} from "@remotion/lambda/client";

import {
  DISK,
  RAM,
  REGION,
  SITE_NAME,
  TIMEOUT,
} from "../../../../config.mjs";
import { COMP_NAME } from "../../../../types/constants";
import { ApiResponse } from "../../../helpers/api-response";

export const POST = async (req: Request) => {
  try {
    if (
      !process.env.AWS_ACCESS_KEY_ID &&
      !process.env.REMOTION_AWS_ACCESS_KEY_ID
    ) {
      throw new TypeError(
        "Set up Remotion Lambda to render videos. See the README.md for how to do so.",
      );
    }
    if (
      !process.env.AWS_SECRET_ACCESS_KEY &&
      !process.env.REMOTION_AWS_SECRET_ACCESS_KEY
    ) {
      throw new TypeError(
        "The environment variable REMOTION_AWS_SECRET_ACCESS_KEY is missing. Add it to your .env file.",
      );
    }

    const body = await req.json();
    const originalFileName = body.originalFileName || "output.mp4";
    const clientInputProps = body.inputProps || {};

    // 制限を解除し全セグメントをそのまま渡す（必要なら将来的に圧縮等の対応を行う）
    const inputProps = {
      ...clientInputProps,
    };

    // 動的に durationInFrames を取得 (未指定ならデフォルト値)
    const durationInFrames = clientInputProps.meta?.durationInFrames || 1200;

    const result = await renderMediaOnLambda({
      codec: "h264",
      functionName: speculateFunctionName({
        diskSizeInMb: DISK,
        memorySizeInMb: RAM,
        timeoutInSeconds: TIMEOUT,
      }),
      region: REGION as AwsRegion,
      serveUrl: SITE_NAME,
      composition: COMP_NAME,
      inputProps: inputProps,
      framesPerLambda: 200,
      concurrencyPerLambda: 1,
      privacy: "public",
      frameRange: [0, Math.max(0, durationInFrames - 1)] as [number, number],
      downloadBehavior: {
        type: "download",
        fileName: originalFileName,
      },
    });

    return new Response(
      JSON.stringify({
        type: "success",
        data: result,
      } as ApiResponse<RenderMediaOnLambdaOutput>),
      {
        headers: {
          "content-type": "application/json",
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        type: "error",
        message: (err as Error).message,
      } as ApiResponse<unknown>),
      {
        status: 500,
        headers: {
          "content-type": "application/json",
        },
      }
    );
  }
};
