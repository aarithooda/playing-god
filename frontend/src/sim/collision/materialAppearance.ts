/** How a material appearance (a renderer hint of the material profile, never a property of the physics) is drawn for debris. */
export interface AppearanceStyle {
  colorHex: string;
  cloudOpacity: number;
}

const STYLES: Record<string, AppearanceStyle> = {
  rock: { colorHex: "#b5a48a", cloudOpacity: 0.28 },
  metal: { colorHex: "#c9ced6", cloudOpacity: 0.3 },
  ice: { colorHex: "#d9eefc", cloudOpacity: 0.26 },
  molten: { colorHex: "#ff8a3d", cloudOpacity: 0.34 },
  gas: { colorHex: "#cfd8e8", cloudOpacity: 0.18 },
  dust: { colorHex: "#9c9488", cloudOpacity: 0.22 },
};

export const DEFAULT_APPEARANCE: AppearanceStyle = STYLES.dust!;

export function appearanceStyle(appearance: string | undefined): AppearanceStyle {
  return (appearance !== undefined ? STYLES[appearance] : undefined) ?? DEFAULT_APPEARANCE;
}
