/** Remove the implementation note from a visual label without changing the backend body name or identity. */
export function displayBodyLabel(name: string): string {
  const label = name.replace(/\s+\(system barycent(?:re|er)\)\s*$/i, "").trim();
  return label || name;
}
