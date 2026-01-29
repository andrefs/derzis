export const isValid = (url: string) => {
  try {
    const obj = new URL(url);
  } catch (e) {
    return false;
  }
  return true;
};
