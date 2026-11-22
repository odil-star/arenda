import { Toaster } from "sonner";
import { useTheme } from "@/lib/theme-context";

export function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="top-center" richColors closeButton toastOptions={{ duration: 3500 }} />;
}
