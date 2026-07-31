import { useEffect, useState } from 'react';

export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const readVersion = window.desktop?.getAppVersion;
    if (!readVersion) return () => {
      active = false;
    };

    void readVersion()
      .then((value) => {
        if (active && value.trim()) setVersion(value.trim());
      })
      .catch(() => {
        if (active) setVersion(null);
      });

    return () => {
      active = false;
    };
  }, []);

  return version;
}
