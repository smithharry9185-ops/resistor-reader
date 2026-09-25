import {
  loadModel,
  unloadModel,
  ocr,
  OCR_LATIN,
  MODEL_TYPES,
} from "@qvac/sdk";

export async function extractText(imagePath) {
  const modelId = await loadModel({
    modelSrc: OCR_LATIN.src,
    modelType: MODEL_TYPES.ggmlOcr,
  });

  try {
    const { blocks } = ocr({ modelId, image: imagePath });
    const detected = await blocks;

    return detected
      .map((b) => (b && typeof b.text === "string" ? b.text.trim() : ""))
      .filter(Boolean)
      .join("\n");
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}