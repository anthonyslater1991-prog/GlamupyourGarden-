export const colors = {
  surface: "#F8F9F5",
  onSurface: "#2C352E",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#3A453C",
  surfaceTertiary: "#EAECE5",
  onSurfaceTertiary: "#4A564C",
  surfaceInverse: "#2A362E",
  onSurfaceInverse: "#F4F6F0",
  brand: "#4A7C59",
  brandPrimary: "#4A7C59",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#6BA3BE",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#EAB364",
  onBrandTertiary: "#3E2B12",
  success: "#598A66",
  warning: "#EAB364",
  error: "#C85C5C",
  onError: "#FFFFFF",
  info: "#6BA3BE",
  border: "#DCE2DA",
  borderStrong: "#B8C4B5",
  divider: "#E6EBE4",
  muted: "#7A857C",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
};

export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  pill: 999,
};

export const fonts = {
  display: "Fraunces",
  displayLight: "FrauncesLight",
  text: "Nunito",
};

export const font = (size: number, weight: "display" | "text" = "text") => ({
  fontFamily: weight === "display" ? fonts.display : fonts.text,
  fontSize: size,
});
