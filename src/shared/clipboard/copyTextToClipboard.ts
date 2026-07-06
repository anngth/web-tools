export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback below.
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";

  try {
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textArea.remove();
  }
}
