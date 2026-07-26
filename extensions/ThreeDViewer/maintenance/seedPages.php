#!/usr/bin/php
<?php

use MediaWiki\MediaWikiServices;

$IP = getenv( 'MW_INSTALL_PATH' ) ?: __DIR__ . '/../../..';
require_once "$IP/maintenance/Maintenance.php";

/** Installs editable starter pages without replacing a wiki administrator's work by default. */
class SeedThreeDViewerPages extends Maintenance {
	public function __construct() {
		parent::__construct();
		$this->addDescription( 'Creates the starter templates and category page for the 3D viewer.' );
		$this->addOption( 'force', 'Replace pages that already exist.' );
		$this->requireExtension( 'ThreeDViewer' );
	}

	public function execute() {
		$root = dirname( __DIR__ );
		$pages = [
			'Template:3D prohlížeč' => "$root/templates/Template-3D-prohlizec.wiki",
			'Template:3D odkaz' => "$root/templates/Template-3D-odkaz.wiki",
			'Template:3D prohlížeč/dokumentace' => "$root/templates/Template-3D-prohlizec-dokumentace.wiki",
			'Template:3D odkaz/dokumentace' => "$root/templates/Template-3D-odkaz-dokumentace.wiki",
			'3D:Femur' => "$root/templates/3D-Femur.wiki",
			'3D:Kategorie' => "$root/templates/3D-Kategorie.wiki",
			'3D:Prohlížeč' => "$root/templates/3D-Prohlizec.wiki"
		];
		$user = User::newSystemUser( '3D viewer installer', [ 'steal' => true ] );
		$factory = MediaWikiServices::getInstance()->getWikiPageFactory();
		foreach ( $pages as $name => $path ) {
			$title = Title::newFromText( $name );
			if ( !$title ) {
				$this->fatalError( "Neplatný název stránky: $name" );
			}
			$page = $factory->newFromTitle( $title );
			if ( $page->exists() && !$this->hasOption( 'force' ) ) {
				$this->output( "Ponecháno: $name\n" );
				continue;
			}
			$content = ContentHandler::makeContent( file_get_contents( $path ), $title );
			$status = $page->doUserEditContent( $content, $user, 'Instalace podpory 3D prohlížeče' );
			if ( !$status->isOK() ) {
				$this->fatalError( "Nelze uložit $name: " . $status->getWikiText( false, false, 'cs' ) );
			}
			$this->output( "Uloženo: $name\n" );
		}
	}
}

$maintClass = SeedThreeDViewerPages::class;
require_once RUN_MAINTENANCE_IF_MAIN;
