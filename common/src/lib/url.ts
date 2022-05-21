
export const isValid = url => {
  try {
    const obj = new URL(url);
  } catch(e) {
    return false;
  }
  return true;
};

