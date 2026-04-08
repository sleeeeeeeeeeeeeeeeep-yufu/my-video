const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");
require("dotenv").config({ path: "C:/Users/yufu/my-video/.env" });

const client = new S3Client({ region: process.env.REMOTION_APP_REGION });

const fileStream = fs.createReadStream("C:/Users/yufu/sawada/796881702.187605.mp4");
const fileSize = fs.statSync("C:/Users/yufu/sawada/796881702.187605.mp4").size;

const command = new PutObjectCommand({
  Bucket: process.env.REMOTION_BUCKET_NAME,
  Key: "videos/test.mp4",
  Body: fileStream,
  ContentLength: fileSize,
  ContentType: "video/mp4",
});

client.send(command).then(() => {
  console.log("アップロード完了！");
  console.log("URL: https://" + process.env.REMOTION_BUCKET_NAME + ".s3.us-east-1.amazonaws.com/videos/test.mp4");
}).catch(err => {
  console.error("エラー:", err);
});