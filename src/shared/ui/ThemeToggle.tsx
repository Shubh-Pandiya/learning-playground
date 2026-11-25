import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../theme/theme';
import { Button } from './Button';

export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <Button
      size="sm"
      variant="ghost"
      iconOnly
      onClick={toggle}
      aria-label={label}
      title={label}
      icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    />
  );
}
