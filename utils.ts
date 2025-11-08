// A simple utility to get the API key. In a real app, this would be more secure.
export const getApiKey = () => {
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) {
        throw new Error('VITE_GEMINI_API_KEY is not configured. Please set it as an environment variable.');
    }
    return key;
};

export const currencyFormatter = (amount: number) => new Intl.NumberFormat('en-US', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

export const generateUUID = () => crypto.randomUUID();

export const safeParseJson = (text: string) => {
    // Find the start and end of the JSON content, stripping markdown fences if they exist.
    let jsonText = text.trim();
    if (jsonText.startsWith('```json')) {
        jsonText = jsonText.substring(7);
        if (jsonText.endsWith('```')) {
            jsonText = jsonText.substring(0, jsonText.length - 3);
        }
    } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.substring(3);
        if (jsonText.endsWith('```')) {
            jsonText = jsonText.substring(0, jsonText.length - 3);
        }
    }

    jsonText = jsonText.trim();
    
    // In case there's still conversational text around the JSON
    const firstBracket = jsonText.indexOf('[');
    const firstBrace = jsonText.indexOf('{');
    
    let start = -1;

    if (firstBracket === -1) start = firstBrace;
    else if (firstBrace === -1) start = firstBracket;
    else start = Math.min(firstBracket, firstBrace);
    
    if (start === -1) throw new Error("Could not find start of JSON object or array in the AI response.");
    
    const lastBracket = jsonText.lastIndexOf(']');
    const lastBrace = jsonText.lastIndexOf('}');
    const end = Math.max(lastBracket, lastBrace);
    
    if (end === -1) throw new Error("Could not find end of JSON object or array in the AI response.");
    
    jsonText = jsonText.substring(start, end + 1);

    try {
        return JSON.parse(jsonText);
    } catch (e: any) {
        console.error("Raw AI response:", text);
        console.error("Cleaned JSON substring for parsing:", jsonText);
        throw new Error(`File processing error: Failed to parse AI response as JSON. Error: ${e.message}`);
    }
};

export const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'object' && error !== null) {
        if ('message' in error && typeof (error as any).message === 'string') {
             return (error as any).message;
        }
        try {
            return JSON.stringify(error);
        } catch {
            return 'An unknown object-based error occurred.';
        }
    }
    return String(error);
};
