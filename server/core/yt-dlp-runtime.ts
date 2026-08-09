/** Build the explicit JavaScript runtime arguments required by YouTube EJS challenges. */
export function getYtDlpRuntimeArgs(denoBinary?: string): string[] {
  const binary = denoBinary?.trim();
  return binary ? ['--js-runtimes', `deno:${binary}`] : [];
}
