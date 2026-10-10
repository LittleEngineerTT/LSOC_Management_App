export function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validUsername(value: string): boolean {
  const username = value.trim().toLowerCase();
  return (
    username.length >= 3 &&
    username.length <= 80 &&
    /^[a-z0-9][a-z0-9._+-]*(@[a-z0-9][a-z0-9.-]*)?$/.test(username)
  );
}
