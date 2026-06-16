export function getPdfPathsFromArgs(args: string[]): string[] {
  return args.filter((arg) => arg.toLowerCase().endsWith('.pdf'));
}
