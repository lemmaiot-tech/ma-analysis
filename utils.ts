/**
 * Retrieves the Gemini API key from environment variables.
 * This is the secure way to handle API keys, ensuring they are not hardcoded in the source code.
 * The API_KEY must be set in your deployment environment's configuration.
 * @returns {string} The API key.
 * @throws {Error} If the API_KEY environment variable is not set.
 */
export const getApiKey = (): string => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY environment variable not set. Please configure it in your deployment environment's secrets/variables settings.");
  }
  return apiKey;
};
