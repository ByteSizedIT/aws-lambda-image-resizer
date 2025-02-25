import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

process.env.FONTCONFIG_PATH = "./fonts";

const S3 = new S3Client();
const DEST_BUCKET = process.env.DEST_BUCKET;
const THUMBNAIL_WIDTH = 200;
const SUPPORTED_FORMATS = {
  jpg: true,
  jpeg: true,
  png: true,
};

export const handler = async (event, context) => {
  const { eventTime, s3 } = event.Records[0];
  const srcBucket = s3.bucket.name;

  // Remove spaces or unicode non-ASCII characters from object key
  const srcKey = decodeURIComponent(s3.object.key.replace(/\+/g, " "));
  const ext = srcKey.replace(/^.*\./, "").toLowerCase();

  console.log(`${eventTime} - ${srcBucket}/${srcKey}`);

  if (!SUPPORTED_FORMATS[ext]) {
    console.log(`ERROR: Unsupported file type (${ext})`);
    return;
  }

  const newKey = srcKey.replace(/\.\w+$/, ".webp");

  // Get uploaded image from source bucket
  try {
    const { Body, ContentType } = await S3.send(
      new GetObjectCommand({
        Bucket: srcBucket,
        Key: srcKey,
      })
    );
    const image = await Body.transformToByteArray();

    // Get image stats/brightness; set watermark color dynamically
    const stats = await sharp(image).stats();
    const avgBrightness =
      (stats.channels[0].mean +
        stats.channels[1].mean +
        stats.channels[2].mean) /
      3;

    const watermarkColor =
      avgBrightness < 128 ? "rgba(204,204,204,0.7)" : "rgba(85,85,85,0.7)";

    // Create a watermark text overlay using SVG
    const watermarkText = "© Leo Keemer";
    const svgWatermark = `<svg width="200" height="200"><text x="50%" y="50%" font-family="CedarvilleCursive" font-size="24" viewBox="0 0 200 200" text-anchor="middle"  opacity="1"  dominant-baseline="middle" fill="${watermarkColor}" transform="rotate(-45, 100, 100)">${watermarkText}</text></svg>`;

    // Convert svgWatermark to Buffer
    const watermarkBuffer = Buffer.from(svgWatermark);

    // Reformat/resize image/add watermark
    const outputBuffer = await sharp(image)
      .toFormat("webp")
      .resize(THUMBNAIL_WIDTH)
      .composite([
        { input: watermarkBuffer, gravity: "southeast", blend: "over" },
      ])
      .toBuffer();

    // Store new image in destination bucket
    await S3.send(
      new PutObjectCommand({
        Bucket: DEST_BUCKET,
        Key: newKey,
        Body: outputBuffer,
        ContentType: "image/webp",
      })
    );
    const message = `Successfully resized ${srcBucket}/${srcKey} and uploaded to ${DEST_BUCKET}/${newKey}`;
    console.log(message);
    return {
      statusCode: 200,
      body: message,
    };
  } catch (error) {
    console.log(error);
  }
};
