// Codex Windows command hooks inherit the selected PowerShell session shell.
// A quoted executable is a string expression unless preceded by &.
export function windowsPowerShellCommand(program, args = []) {
  const literal = value => {
    if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) throw new Error('Invalid hook argument');
    return `'${value.replaceAll("'", "''")}'`;
  };
  return `& ${[program, ...args].map(literal).join(' ')}`;
}
