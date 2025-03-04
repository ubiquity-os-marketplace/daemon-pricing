import { Context } from "../types/context";
import OpenAI from "openai";

export async function estimateTimeWithAi(context: Context, issueTitle: string, issueBody: string): Promise<string | null> {
  const { config, logger } = context;

  if (!config.aiEstimation?.enabled) {
    logger.debug("AI estimation is not enabled");
    return null;
  }

  if (!config.aiEstimation.openaiApiKey) {
    logger.error("OpenAI API key is not configured");
    return null;
  }

  try {
    // API URLs
    const OPENAI_API_URL = "https://api.openai.com/v1";
    const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";

    const isFineTunedModel = config.aiEstimation.modelName.startsWith("ft:");

    const openai = new OpenAI({
      apiKey: config.aiEstimation.openaiApiKey,
      baseURL: isFineTunedModel ? OPENAI_API_URL : OPENROUTER_API_URL,
    });

    // Get available time labels from config
    const timeLabels = config.labels.time.map((label) => label.name);

    const prompt = `Estimate the development time for this GitHub issue. Choose exactly one option from: ${timeLabels.map((label) => `"${label}"`).join(", ")}.

${issueTitle}

${issueBody}`;

    const response = await openai.chat.completions.create({
      model: config.aiEstimation.modelName,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 20,
    });

    const timeLabel = response.choices[0]?.message?.content?.trim();

    // Validate that the response matches one of the configured time labels
    const validTimeLabels = timeLabels;
    if (timeLabel && validTimeLabels.includes(timeLabel)) {
      return timeLabel;
    } else {
      logger.error("AI returned invalid time label format", { timeLabel });
      return null;
    }
  } catch (error) {
    logger.error("Error calling OpenAI API", { stack: error instanceof Error ? error.stack : String(error) });
    return null;
  }
}
