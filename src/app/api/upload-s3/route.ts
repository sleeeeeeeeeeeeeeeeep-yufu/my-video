import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const uuid = crypto.randomUUID();
    const key = `uploads/${uuid}.mp4`;
    const buffer = Buffer.from(await file.arrayBuffer());

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.REMOTION_BUCKET_NAME || "",
        Key: key,
        Body: buffer,
        ContentType: "video/mp4",
      })
    );

    const url = `https://${process.env.REMOTION_BUCKET_NAME}.s3.${process.env.REMOTION_APP_REGION || "us-east-1"}.amazonaws.com/${key}`;

    return NextResponse.json({ url, originalFileName: file.name });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
