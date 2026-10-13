export function isChunkLoadError(error: Error): boolean {
  return /ChunkLoadError|Loading (?:CSS )?chunk|Failed to fetch dynamically imported module/i.test(`${error.name} ${error.message}`);
}
