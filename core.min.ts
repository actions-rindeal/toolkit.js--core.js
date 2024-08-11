import { randomUUID } from 'crypto';
import { appendFileSync, existsSync } from 'fs';
import { EOL, type } from 'os';
import { delimiter, sep } from 'path';
import { env, stdout, exitCode } from 'process';

/**
 * Represents the properties of an annotation.
 */
interface AnnotationProperties {
    /** A title for the annotation */
    title?: string;
    /** The path of the file for which the annotation should be created */
    file?: string;
    /** The start line for the annotation */
    startLine?: number;
    /** The end line for the annotation. Defaults to `startLine` when `startLine` is provided */
    endLine?: number;
    /** The start column for the annotation. Cannot be sent when `startLine` and `endLine` are different values */
    startColumn?: number;
    /** The end column for the annotation. Cannot be sent when `startLine` and `endLine` are different values. Defaults to `startColumn` when `startColumn` is provided */
    endColumn?: number;
}

/**
 * Gets the input value of the given name from the environment variables.
 * @param name - The name of the input to get. The name is case-insensitive and can use either dashes or underscores
 * @param required - Whether the input is required
 * @returns The input value
 * @throws Error if required is true and the input is not provided
 */
export function getInput(name: string, required = false): string {
    const key = `INPUT_${name.replace(/-/g, '_').toUpperCase()}`;
    const val = env[key] || '';
    if (required && !val) throw new Error(`Input required and not supplied: ${name}`);
    return val.trim();
}

/**
 * Gets the trimmed values of a multiline input.
 * @param name - The name of the input to get. The name is case-insensitive and can use either dashes or underscores
 * @param required - If true, the input is required
 * @returns The trimmed input values
 * @throws Error if required is true and the input is not provided
 */
export function getMultilineInput(name: string, required = false): string[] {
    return getInput(name, required).split('\n').filter(Boolean).map(s => s.trim());
}

/**
 * Gets the boolean input value.
 * @param name - The name of the input to get. The name is case-insensitive and can use either dashes or underscores
 * @param required - If true, the input is required
 * @returns The boolean value of the input
 * @throws Error if required is true and the input is not provided
 * @throws TypeError if the input value is not a valid boolean
 */
export function getBooleanInput(name: string, required = false): boolean {
    const val = getInput(name, required).trim().toLowerCase();
    if (val === 'true') return true;
    if (val === 'false') return false;
    throw new TypeError(`Input "${name}"="${val}" is not a valid boolean.`);
}

/**
 * Sets env variable for this action and future actions in the job
 * @param name - The name of the variable to set
 * @param val - The value of the variable
 */
export function exportVariable(name: string, val: any): void {
    env[name] = toCommandValue(val);
    issueFileCommand('ENV', prepareKeyValueMessage(name, val));
}

/**
 * Masks a secret in logs.
 * @param secret - The secret to mask
 */
export function setSecret(secret: string): void {
    issueCommand('add-mask', {}, secret);
}

/**
 * Adds a path to the PATH environment variable.
 * @param inputPath - The path to add
 */
export function addPath(inputPath: string): void {
    issueFileCommand('PATH', inputPath);
    env.PATH = `${inputPath}${delimiter}${env.PATH}`;
}

/**
 * Checks if the runner is in debug mode.
 * @returns Whether the runner is in debug mode
 */
export function isDebug(): boolean {
    return env['RUNNER_DEBUG'] === '1';
}

/**
 * Issues a debug command.
 * @param message - The debug message
 */
export function debug(message: string): void {
    issueCommand('debug', {}, message);
}

/**
 * Writes info to log with console.log.
 * @param message - Info message
 */
export function info(message: string): void {
    stdout.write(message + EOL);
}

/**
 * Adds a notice issue.
 * @param message - Notice issue message
 * @param properties - Optional properties for the annotation
 */
export function notice(message: string | Error, properties: AnnotationProperties = {}): void {
    issueCommand('notice', toCommandProperties(properties), message instanceof Error ? message.toString() : message);
}

/**
 * Adds a warning issue.
 * @param message - Warning issue message
 * @param properties - Optional properties for the annotation
 */
export function warning(message: string | Error, properties: AnnotationProperties = {}): void {
    issueCommand('warning', toCommandProperties(properties), message instanceof Error ? message.toString() : message);
}

/**
 * Adds an error issue.
 * @param message - Error issue message
 * @param properties - Optional properties for the annotation
 */
export function error(message: string | Error, properties: AnnotationProperties = {}): void {
    issueCommand('error', toCommandProperties(properties), message instanceof Error ? message.toString() : message);
}

/**
 * Sets the action status to failed.
 * @param message - Add error issue message
 */
export function setFailed(message: string | Error): void {
    exitCode = 1;
    error(message);
}

/**
 * Begins an output group.
 * @param name - The name of the output group
 */
export function startGroup(name: string): void {
    issueCommand('group', {}, name);
}

/**
 * Wrap an asynchronous function call in a group.
 * @param name - The name of the group
 * @param fn - The function to wrap in the group
 * @returns The result of the function
 */
export async function group<T>(name: string, fn: () => Promise<T>): Promise<T> {
    startGroup(name);
    try {
        return await fn();
    } finally {
        endGroup();
    }
}

/**
 * Ends an output group
 */
export function endGroup(): void {
    issueCommand('endgroup', {});
}

/**
 * Enables or disables the echoing of commands into stdout for the rest of the step.
 * @param enabled - Whether to enable command echoing
 */
export function setCommandEcho(enabled: boolean): void {
    issueCommand('echo', {}, enabled ? 'on' : 'off');
}

/**
 * Gets the value of a state set by this action's main execution.
 * @param name - Name of the state to get
 * @returns The state value
 */
export function getState(name: string): string {
    return env[`STATE_${name}`] || '';
}

/**
 * Saves state for current action, the state can only be retrieved by this action's post job execution.
 * @param name - Name of the state to store
 * @param value - Value to store
 */
export function saveState(name: string, value: any): void {
    issueFileCommand('STATE', prepareKeyValueMessage(name, value));
}

/**
 * Sets the name of the output to set.
 * @param name - Name of the output to set
 * @param value - Value to store
 */
export function setOutput(name: string, value: any): void {
    issueFileCommand('OUTPUT', prepareKeyValueMessage(name, value));
}

/**
 * Converts the given path to the posix form.
 * @param pth - Path to transform
 * @returns Posix path
 */
export function toPosixPath(pth: string): string {
    return pth.replace(/[\\]/g, '/');
}

/**
 * Converts the given path to the win32 form.
 * @param pth - Path to transform
 * @returns Win32 path
 */
export function toWin32Path(pth: string): string {
    return pth.replace(/[/]/g, '\\');
}

/**
 * Converts the given path to a platform-specific path.
 * @param pth - The path to platformize
 * @returns The platform-specific path
 */
export function toPlatformPath(pth: string): string {
    return pth.replace(/[/\\]/g, sep);
}

// Private helper functions (these don't need to be exported)
function issueCommand(command: string, properties: { [key: string]: string } = {}, message: string = ''): void {
    const propString = Object.entries(properties)
        .filter(([_, v]) => v)
        .map(([k, v]) => `${k}=${escapeProperty(v)}`)
        .join(',');
    stdout.write(`::${command}${propString ? ` ${propString}` : ''}::${escapeData(message)}${EOL}`);
}

function issueFileCommand(command: string, message: string): void {
    const filePath = env[`GITHUB_${command}`];
    if (!filePath) throw new Error(`Unable to find environment variable for file command ${command}`);
    if (!existsSync(filePath)) throw new Error(`Missing file at path: ${filePath}`);
    appendFileSync(filePath, `${toCommandValue(message)}${EOL}`, { encoding: 'utf8' });
}

function escapeData(s: string): string {
    return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(s: string): string {
    return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function toCommandValue(input: any): string {
    if (input === null || input === undefined) return '';
    return (typeof input === 'string' || input instanceof String) ? input as string : JSON.stringify(input);
}

function toCommandProperties(
  { title, file, startLine, endLine, startColumn, endColumn }: AnnotationProperties
): { [key: string]: string } {
  return (title === null || title === undefined) ? { title, file, line: startLine, endLine, col: startColumn, endColumn } : {};
}

function prepareKeyValueMessage(key: string, value: any): string {
    const delimiter = `ghadelimiter_${randomUUID()}`;
    return `${key}<<${delimiter}${EOL}${toCommandValue(value)}${EOL}${delimiter}`;
}

/**
 * Provides methods to build a summary of the action's results.
 */
export const summary = new class Summary {
    private buffer = '';
    private filePath?: string;

    /**
     * Finds the summary file path from the environment, rejects if env var is not found or file does not exist.
     * @returns The path of the summary file.
     */
    private async getFilePath(): Promise<string> {
        if (this.filePath) return this.filePath;
        const pathFromEnv = Core.getInput('GITHUB_STEP_SUMMARY');
        if (!pathFromEnv) {
            throw new Error('Unable to find environment variable for $GITHUB_STEP_SUMMARY.');
        }
        try {
            await fs.access(pathFromEnv, constants.R_OK | constants.W_OK);
        } catch {
            throw new Error(`Unable to access summary file: '${pathFromEnv}'.`);
        }
        this.filePath = pathFromEnv;
        return this.filePath;
    }

    /**
     * Wraps content in an HTML tag, adding any HTML attributes.
     */
    private static wrap(tag: string, content: string | null, attrs: {[key: string]: string} = {}): string {
        const htmlAttrs = Object.entries(attrs)
            .map(([key, value]) => ` ${key}="${value}"`)
            .join('');
        if (!content) {
            return `<${tag}${htmlAttrs}>`;
        }
        return `<${tag}${htmlAttrs}>${content}</${tag}>`;
    }

    /**
     * Writes text in the buffer to the summary buffer file and empties buffer.
     */
    async write(options: SummaryWriteOptions = {}): Promise<this> {
        const filePath = await this.getFilePath();
        const writeFunc = options.overwrite ? fs.writeFile : fs.appendFile;
        await writeFunc(filePath, this.buffer, { encoding: 'utf8' });
        return this.emptyBuffer();
    }

    /**
     * Clears the summary buffer and wipes the summary file.
     */
    async clear(): Promise<this> {
        return this.emptyBuffer().write({ overwrite: true });
    }

    /**
     * Returns the current summary buffer as a string.
     */
    stringify(): string {
        return this.buffer;
    }

    /**
     * If the summary buffer is empty.
     */
    isEmptyBuffer(): boolean {
        return this.buffer.length === 0;
    }

    /**
     * Resets the summary buffer without writing to summary file.
     */
    emptyBuffer(): this {
        this.buffer = '';
        return this;
    }

    /**
     * Adds raw text to the summary buffer.
     */
    addRaw(text: string, addEOL = false): this {
        this.buffer += text;
        return addEOL ? this.addEOL() : this;
    }

    /**
     * Adds the operating system-specific end-of-line marker to the buffer.
     */
    addEOL(): this {
        return this.addRaw(EOL);
    }

    /**
     * Adds an HTML codeblock to the summary buffer.
     */
    addCodeBlock(code: string, lang?: string): this {
        const attrs = lang ? { lang } : {};
        const element = this.wrap('pre', this.wrap('code', code), attrs);
        return this.addRaw(element).addEOL();
    }

    /**
     * Adds an HTML list to the summary buffer.
     */
    addList(items: string[], ordered = false): this {
        const tag = ordered ? 'ol' : 'ul';
        const listItems = items.map(item => this.wrap('li', item)).join('');
        const element = this.wrap(tag, listItems);
        return this.addRaw(element).addEOL();
    }

    /**
     * Adds an HTML table to the summary buffer.
     */
    addTable(rows: SummaryTableRow[]): this {
        const tableBody = rows
            .map(row => {
                const cells = row
                    .map(cell => {
                        if (typeof cell === 'string') {
                            return this.wrap('td', cell);
                        }
                        const { header, data, colspan, rowspan } = cell;
                        const tag = header ? 'th' : 'td';
                        const attrs = {
                            ...(colspan && { colspan }),
                            ...(rowspan && { rowspan })
                        };
                        return this.wrap(tag, data, attrs);
                    })
                    .join('');
                return this.wrap('tr', cells);
            })
            .join('');
        const element = this.wrap('table', tableBody);
        return this.addRaw(element).addEOL();
    }

    /**
     * Adds an HTML image tag to the summary buffer.
     */
    addImage(src: string, alt: string, options: SummaryImageOptions = {}): this {
        const { width, height } = options;
        const element = this.wrap('img', null, { src, alt, ...(width && { width }), ...(height && { height }) });
        return this.addRaw(element).addEOL();
    }

    /**
     * Adds an HTML section heading element.
     */
    addHeading(text: string, level?: number | string): this {
        const tag = `h${level}`;
        const allowedTag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag) ? tag : 'h1';
        const element = this.wrap(allowedTag, text);
        return this.addRaw(element).addEOL();
    }

    /**
     * Adds an HTML thematic break (<hr>) to the summary buffer.
     */
    addSeparator(): this {
        const element = this.wrap('hr', null);
        return this.addRaw(element).addEOL();
    }

    /**
     * Adds an HTML line break (<br>) to the summary buffer.
     */
    addBreak(): this {
        const element = this.wrap('br', null);
        return this.addRaw(element).addEOL();
    }

    /**
     * Adds an HTML blockquote to the summary buffer.
     */
    addQuote(text: string, cite?: string): this {
        const attrs = cite ? { cite } : {};
        const element = this.wrap('blockquote', text, attrs);
        return this.addRaw(element).addEOL();
    }

    /**
     * Adds an HTML anchor tag to the summary buffer.
     */
    addLink(text: string, href: string): this {
        const element = this.wrap('a', text, { href });
        return this.addRaw(element).addEOL();
    }
}
