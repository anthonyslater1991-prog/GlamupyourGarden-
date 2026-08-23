import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { API, getMemToken } from "@/src/lib/api";

// Upload a local image uri to the backend, returns the storage path.
export async function uploadImage(uri: string): Promise<string> {
  const form = new FormData();
  const name = `garden_${Date.now()}.jpg`;
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri, name, type: "image/jpeg" } as any);
  }
  const token = getMemToken();
  const res = await fetch(`${API}/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    throw new Error("Upload failed");
  }
  const data = await res.json();
  return data.path as string;
}

export async function pickFromLibrary(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.8,
    allowsEditing: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  return res.assets[0].uri;
}

export async function captureFromCamera(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchCameraAsync({
    quality: 0.8,
    allowsEditing: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  return res.assets[0].uri;
}

export async function libraryPermissionStatus() {
  return ImagePicker.getMediaLibraryPermissionsAsync();
}
export async function cameraPermissionStatus() {
  return ImagePicker.getCameraPermissionsAsync();
}
