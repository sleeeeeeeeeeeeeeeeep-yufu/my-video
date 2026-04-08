import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname /*, clientPayload */) => {
        // ここで認証チェックなどを行えます。
        // 今回はシンプルにするため制限なしで許可します。
        return {
          allowedContentTypes: ['video/mp4'],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            // 追加の情報をトークンに埋め込むことが可能です
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // アップロード完了後のサーバーサイド処理が必要な場合はここに記述
        console.log('blob upload completed', blob, tokenPayload);
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
