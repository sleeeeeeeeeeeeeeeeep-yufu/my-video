import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const s3 = new S3Client({
  region: process.env.REMOTION_APP_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // ログを出力してVercel上で確認できるようにする
    console.log("Starting get-signed-url request");
    
    const body = await request.text();
    if (!body) {
      throw new Error("Empty request body");
    }

    let fileName, contentType;
    try {
      const parsed = JSON.parse(body);
      fileName = parsed.fileName;
      contentType = parsed.contentType;
    } catch (e) {
      console.error("Failed to parse request JSON:", body);
      throw new Error("Invalid JSON body in request");
    }

    if (!fileName) {
      return NextResponse.json({ error: "No fileName provided" }, { status: 400 });
    }

    const uuid = crypto.randomUUID();
    const ext = fileName.split('.').pop() || 'mp4';
    const key = `uploads/${uuid}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: process.env.REMOTION_BUCKET_NAME || "",
      Key: key,
      ContentType: contentType || "video/mp4",
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    const url = `https://${process.env.REMOTION_BUCKET_NAME}.s3.${process.env.REMOTION_APP_REGION || "us-east-1"}.amazonaws.com/${key}`;

    console.log("Successfully generated presigned URL for key:", key);

    return NextResponse.json({ presignedUrl, url, originalFileName: fileName });
  } catch (error) {
    console.error("get-signed-url API Error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
