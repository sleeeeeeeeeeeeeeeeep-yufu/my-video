import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";

const s3 = new S3Client({
  region: process.env.REMOTION_APP_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { fileName, contentType } = await request.json();

    if (!fileName) {
      return NextResponse.json({ error: "No fileName provided" }, { status: 400 });
    }

    const uuid = crypto.randomUUID();
    // Maintain extension if possible, otherwise force mp4
    const ext = fileName.split('.').pop() || 'mp4';
    const key = `uploads/${uuid}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: process.env.REMOTION_BUCKET_NAME || "",
      Key: key,
      ContentType: contentType || "video/mp4",
    });

    // Generate a pre-signed URL valid for 1 hour
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    const url = `https://${process.env.REMOTION_BUCKET_NAME}.s3.${process.env.REMOTION_APP_REGION || "us-east-1"}.amazonaws.com/${key}`;

    return NextResponse.json({ presignedUrl, url, originalFileName: fileName });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
