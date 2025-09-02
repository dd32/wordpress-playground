import type { StepHandler } from '.';
import type { InstallAssetOptions } from './install-asset';
import { installAsset } from './install-asset';
import { activateTheme } from './activate-theme';
import type { Directory } from '../resources';
import { importThemeStarterContent } from './import-theme-starter-content';
import { zipNameToHumanName } from '../utils/zip-name-to-human-name';
import { writeFiles } from '@php-wasm/universal';
import { joinPaths } from '@php-wasm/util';
import { logger } from '@php-wasm/logger';

/**
 * @inheritDoc installTheme
 * @hasRunnableExample
 * @needsLogin
 * @example
 *
 * <code>
 * {
 * 		"step": "installTheme",
 * 		"themeData": {
 * 			"resource": "wordpress.org/themes",
 * 			"slug": "pendant"
 * 		},
 * 		"options": {
 * 			"activate": true,
 * 			"importStarterContent": true
 * 		}
 * }
 * </code>
 */
export interface InstallThemeStep<FileResource, DirectoryResource>
	extends Pick<InstallAssetOptions, 'ifAlreadyInstalled'> {
	/**
	 * The step identifier.
	 */
	step: 'installTheme';
	/**
	 * The theme files to install. It can be either a theme zip file, or a
	 * directory containing all the theme files at its root.
	 */
	themeData: FileResource | DirectoryResource;
	/**
	 * @deprecated. Use 'themeData' instead.
	 */
	themeZipFile?: FileResource;
	/**
	 * Optional installation options.
	 */
	options?: InstallThemeOptions;
}

export interface InstallThemeOptions {
	/**
	 * Whether to activate the theme after installing it.
	 */
	activate?: boolean;
	/**
	 * Whether to import the theme's starter content after installing it.
	 */
	importStarterContent?: boolean;
	/**
	 * The name of the folder to install the theme to. Defaults to guessing from themeData
	 */
	targetFolderName?: string;
}

/**
 * Installs a WordPress theme in the Playground.
 *
 * @param playground The playground client.
 * @param themeZipFile The theme zip file.
 * @param options Optional. Set `activate` to false if you don't want to activate the theme.
 */
export const installTheme: StepHandler<
	InstallThemeStep<File, Directory>
> = async (
	playground,
	{ themeData, themeZipFile, ifAlreadyInstalled, options = {} },
	progress
) => {
	if (themeZipFile) {
		themeData = themeZipFile;
		logger.warn(
			'The "themeZipFile" option is deprecated. Use "themeData" instead.'
		);
	}

	const targetFolderName =
		'targetFolderName' in options ? options.targetFolderName : '';
	let assetFolderName = '';
	let assetNiceName = '';
	if (themeData instanceof File) {
		// @TODO: Consider validating whether this is a zip file?
		const zipFileName = themeData.name.split('/').pop() || 'theme.zip';
		assetNiceName = zipNameToHumanName(zipFileName);

		progress?.tracker.setCaption(`Installing the ${assetNiceName} theme`);
		const assetResult = await installAsset(playground, {
			ifAlreadyInstalled,
			zipFile: themeData,
			targetPath: `${await playground.documentRoot}/wp-content/themes`,
			targetFolderName: targetFolderName,
		});
		assetFolderName = assetResult.assetFolderName;

		// Determine if a parent theme needs to be installed.
		const docroot = await playground.documentRoot;
		const result = await playground.run({
			code: `<?php
				require_once( getenv('docroot') . "/wp-load.php" );

				$theme = wp_get_theme( getenv('assetFolderName') );

				if (
					! $theme->exists() ||
					$theme->get_stylesheet() !== getenv('assetFolderName') ||
					$theme->get_stylesheet() === $theme>get_template() ||
					$theme->parent()->exists()
				) {
					die();
				}

				die( $theme->get_template() );
			`,
			env: {
				docroot,
				assetFolderName,
			},
		});
		if ( result.text.length ) {
			// A parent theme is required.
			const parentThemeSlug = result.text;
			logger.info( `The theme ${ assetFolderName } requires the parent theme ${ parentThemeSlug } to be installed.` );
		}
	} else {
		assetNiceName = themeData.name;
		assetFolderName = targetFolderName || assetNiceName;

		progress?.tracker.setCaption(`Installing the ${assetNiceName} theme`);
		const themeDirectoryPath = joinPaths(
			await playground.documentRoot,
			'wp-content',
			'themes',
			assetFolderName
		);
		await writeFiles(playground, themeDirectoryPath, themeData.files, {
			rmRoot: true,
		});
	}

	const activate = 'activate' in options ? options.activate : true;
	if (activate) {
		await activateTheme(
			playground,
			{
				themeFolderName: assetFolderName,
			},
			progress
		);
	}

	const importStarterContent =
		'importStarterContent' in options
			? options.importStarterContent
			: false;
	if (importStarterContent) {
		await importThemeStarterContent(
			playground,
			{
				themeSlug: assetFolderName,
			},
			progress
		);
	}
};
