interface AxiosErrorResponse {
    response?: {
        data?: {
            message?: string;
        };
        status?: number;
    };
}

function isAxiosError(error: unknown): error is AxiosErrorResponse {
    return typeof error === 'object' && error !== null && 'response' in error;
}

export function extractErrorMessage(error: unknown, fallback: string): string {
    if (isAxiosError(error)) {
        return error.response?.data?.message || fallback;
    }
    if (error instanceof Error) {
        return error.message || fallback;
    }
    return fallback;
}

export function extractErrorStatus(error: unknown): number | undefined {
    if (isAxiosError(error)) {
        return error.response?.status;
    }
    return undefined;
}
