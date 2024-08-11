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
 * This class provides utility methods for handling environment variables, issuing commands, logging, and managing output groups. It is designed to be used in a Node.js environment.
 */
export class Core {
    /**
     * Gets the input value of the given name from the environment variables.
     * @param name - The name of the input to get. The name is case-insensitive and can use either dashes or underscores
     * @param required - Whether the input is required
     * @returns The input value
     * @throws Error if required is true and the input is not provided
     */
    static getInput(name: string, required = false): string {
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
    static getMultilineInput(name: string, required = false): string[] {
        return this.getInput(name, required).split('\n').filter(Boolean).map(s => s.trim());
    }

    /**
     * Gets the boolean input value.
     * @param name - The name of the input to get. The name is case-insensitive and can use either dashes or underscores
     * @param required - If true, the input is required
     * @returns The boolean value of the input
     * @throws Error if required is true and the input is not provided
     * @throws TypeError if the input value is not a valid boolean
     */
    static getBooleanInput(name: string, required = false): boolean {
        const val = this.getInput(name, required).trim().toLowerCase();
        if (val === 'true') return true;
        if (val === 'false') return false;
        throw new TypeError(`Input "${name}"="${val}" is not a valid boolean.`);
    }

    /**
     * Sets env variable for this action and future actions in the job
     * @param name - The name of the variable to set
     * @param val - The value of the variable
     */
    static exportVariable(name: string, val: any): void {
        env[name] = this.toCommandValue(val);
        this.issueFileCommand('ENV', this.prepareKeyValueMessage(name, val));
    }

    /**
     * Masks a secret in logs.
     * @param secret - The secret to mask
     */
    static setSecret(secret: string): void {
        this.issueCommand('add-mask', {}, secret);
    }

    /**
     * Adds a path to the PATH environment variable.
     * @param inputPath - The path to add
     */
    static addPath(inputPath: string): void {
        this.issueFileCommand('PATH', inputPath);
        env.PATH = `${inputPath}${delimiter}${env.PATH}`;
    }

    /**
     * Checks if the runner is in debug mode.
     * @returns Whether the runner is in debug mode
     */
    static isDebug(): boolean {
        return env['RUNNER_DEBUG'] === '1';
    }

    /**
     * Issues a debug command.
     * @param message - The debug message
     */
    static debug(message: string): void {
        this.issueCommand('debug', {}, message);
    }

    /**
     * Writes info to log with console.log.
     * @param message - Info message
     */
    static info(message: string): void {
        stdout.write(message + EOL);
    }

    /**
     * Adds a notice issue.
     * @param message - Notice issue message
     * @param properties - Optional properties for the annotation
     */
    static notice(message: string | Error, properties: AnnotationProperties = {}): void {
        this.issueCommand('notice', this.toCommandProperties(properties), message instanceof Error ? message.toString() : message);
    }

    /**
     * Adds a warning issue.
     * @param message - Warning issue message
     * @param properties - Optional properties for the annotation
     */
    static warning(message: string | Error, properties: AnnotationProperties = {}): void {
        this.issueCommand('warning', this.toCommandProperties(properties), message instanceof Error ? message.toString() : message);
    }

    /**
     * Adds an error issue.
     * @param message - Error issue message
     * @param properties - Optional properties for the annotation
     */
    static error(message: string | Error, properties: AnnotationProperties = {}): void {
        this.issueCommand('error', this.toCommandProperties(properties), message instanceof Error ? message.toString() : message);
    }

    /**
     * Sets the action status to failed.
     * @param message - Add error issue message
     */
    static setFailed(message: string | Error): void {
        exitCode = 1;
        this.error(message);
    }

    /**
     * Begins an output group.
     * @param name - The name of the output group
     */
    static startGroup(name: string): void {
        this.issueCommand('group', {}, name);
    }

    /**
     * Wrap an asynchronous function call in a group.
     * @param name - The name of the group
     * @param fn - The function to wrap in the group
     * @returns The result of the function
     */
    static async group<T>(name: string, fn: () => Promise<T>): Promise<T> {
        this.startGroup(name);
        try {
            return await fn();
        } finally {
            this.endGroup();
        }
    }

    /**
     * Ends an output group
     */
    static endGroup(): void {
        this.issueCommand('endgroup', {});
    }

    /**
     * Enables or disables the echoing of commands into stdout for the rest of the step.
     * @param enabled - Whether to enable command echoing
     */
    static setCommandEcho(enabled: boolean): void {
        this.issueCommand('echo', {}, enabled ? 'on' : 'off');
    }

    /**
     * Gets the value of a state set by this action's main execution.
     * @param name - Name of the state to get
     * @returns The state value
     */
    static getState(name: string): string {
        return env[`STATE_${name}`] || '';
    }

    /**
     * Saves state for current action, the state can only be retrieved by this action's post job execution.
     * @param name - Name of the state to store
     * @param value - Value to store
     */
    static saveState(name: string, value: any): void {
        this.issueFileCommand('STATE', this.prepareKeyValueMessage(name, value));
    }

    /**
     * Sets the name of the output to set.
     * @param name - Name of the output to set
     * @param value - Value to store
     */
    static setOutput(name: string, value: any): void {
        this.issueFileCommand('OUTPUT', this.prepareKeyValueMessage(name, value));
    }

    /**
     * Converts the given path to the posix form.
     * @param pth - Path to transform
     * @returns Posix path
     */
    static toPosixPath(pth: string): string {
        return pth.replace(/[\\]/g, '/');
    }

    /**
     * Converts the given path to the win32 form.
     * @param pth - Path to transform
     * @returns Win32 path
     */
    static toWin32Path(pth: string): string {
        return pth.replace(/[/]/g, '\\');
    }

    /**
     * Converts the given path to a platform-specific path.
     * @param pth - The path to platformize
     * @returns The platform-specific path
     */
    static toPlatformPath(pth: string): string {
        return pth.replace(/[/\\]/g, sep);
    }

    private static issueCommand(command: string, properties: { [key: string]: string } = {}, message: string = ''): void {
        const propString = Object.entries(properties)
            .filter(([_, v]) => v)
            .map(([k, v]) => `${k}=${this.escapeProperty(v)}`)
            .join(',');
        stdout.write(`::${command}${propString ? ` ${propString}` : ''}::${this.escapeData(message)}${EOL}`);
    }

    private static issueFileCommand(command: string, message: string): void {
        const filePath = env[`GITHUB_${command}`];
        if (!filePath) throw new Error(`Unable to find environment variable for file command ${command}`);
        if (!existsSync(filePath)) throw new Error(`Missing file at path: ${filePath}`);
        appendFileSync(filePath, `${this.toCommandValue(message)}${EOL}`, { encoding: 'utf8' });
    }

    private static escapeData(s: string): string {
        return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    }

    private static escapeProperty(s: string): string {
        return this.escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
    }

    private static toCommandValue(input: any): string {
        if (input === null || input === undefined) return '';
        return (typeof input === 'string' || input instanceof String) ? input as string : JSON.stringify(input);
    }

    private static toCommandProperties(
      { title, file, startLine, endLine, startColumn, endColumn }: AnnotationProperties
    ): CommandProperties {
      return (title === null || title === undefined) ? { title, file, line: startLine, endLine, col: startColumn, endColumn } : {};
    }

    private static prepareKeyValueMessage(key: string, value: any): string {
        const delimiter = `ghadelimiter_${randomUUID()}`;
        return `${key}<<${delimiter}${EOL}${this.toCommandValue(value)}${EOL}${delimiter}`;
    }
}
