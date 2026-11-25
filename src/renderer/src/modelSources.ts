// The sources that play a 3D file from disk (the session carries its path in
// modelPath / modelFiles) : the Model, and Strata (a scan as its cloud).
export const MODEL_FILE_SOURCES: readonly string[] = ['gen-model', 'gen-strata']

export const takesModelFile = (shaderId: string | null | undefined): boolean => !!shaderId && MODEL_FILE_SOURCES.includes(shaderId)
