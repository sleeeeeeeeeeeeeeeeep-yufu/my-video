import { estimatePrice } from "@remotion/lambda";
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
      // 以前は「framesPerLambda: 200」固定でしたが、フル尺になったことでLambdaの分割起動数（並列処理数）が
      // アカウントの初期上限（10個など）を超えて Rate Exceeded となる問題が発生します。
      // これを解決するため、最低200フレームは処理させつつ、全体の起動Lambda数が最大でも8個（安全圏）以下になるように動的調整します。
      framesPerLambda: Math.max(200, Math.ceil(durationInFrames / 8)),
      concurrencyPerLambda: 1,
      privacy: "public",
      frameRange: [0, Math.max(0, durationInFrames - 1)] as [number, number],
      downloadBehavior: {
        type: "download",
        fileName: originalFileName,
      },
    });

    console.log("Lambda Render Result:", JSON.stringify(result, null, 2));


    // コスト見積もりの手動計算
    // 1フレームあたりのレンダリング時間を平均150msと仮定して計算
    const framesPerLambdaCalc = Math.max(200, Math.ceil(durationInFrames / 8));
    const lambdasInvoked = Math.ceil(durationInFrames / framesPerLambdaCalc);
    const estimatedRenderDurationInMs = durationInFrames * 150;

    const estimatedCost = estimatePrice({
      region: REGION as AwsRegion,
      memorySizeInMb: RAM,
      diskSizeInMb: DISK,
      durationInMilliseconds: estimatedRenderDurationInMs,
      lambdasInvoked,
    });

    console.log(`Manual Cost Estimate: $${estimatedCost.toFixed(4)}`);

    return new Response(
      JSON.stringify({
        type: "success",
        data: {
          ...result,
          estimatedCost, // 独自に追加
        },
      } as ApiResponse<RenderMediaOnLambdaOutput & { estimatedCost: number }>),
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
