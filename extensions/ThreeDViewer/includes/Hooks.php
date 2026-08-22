<?php

namespace MediaWiki\Extension\ThreeDViewer;

use Html;
use Parser;
use PPFrame;

/** Parser hooks used by the two small wiki templates bundled with the viewer. */
class Hooks {
	public static function onParserFirstCallInit( Parser $parser ): void {
		$parser->setHook( 'model3d', [ self::class, 'renderModel3d' ] );
		$parser->setHook( 'model3d-link', [ self::class, 'renderModel3dLink' ] );
		$parser->setHook( 'model3d-categories', [ self::class, 'renderCategoryStore' ] );
		$parser->setFunctionHook( 'model3d', [ self::class, 'renderModel3dFunction' ] );
		$parser->setFunctionHook( 'model3dlink', [ self::class, 'renderModel3dLinkFunction' ] );
	}

	/**
	 * Renders an iframe only when a model article is explicitly given.
	 * A <model3d file="…"> JSON block remains an inert, readable data source
	 * on pages in namespace 3D and is read by the Node viewer through the API.
	 */
	public static function renderModel3d( ?string $input, array $args, Parser $parser, PPFrame $frame ): array {
		$article = trim( $frame->expand( $args['article'] ?? '' ) );
		if ( $article === '' ) {
			return [
				Html::rawElement( 'span', [ 'class' => 'model3d-data-note' ], 'Konfigurace 3D modelu je uložená v tomto článku.' ),
				'isHTML' => true,
				'noparse' => true
			];
		}

		$height = $frame->expand( $args['height'] ?? $args['výška'] ?? '560' );
		$title = $frame->expand( $args['title'] ?? $args['popisek'] ?? 'Interaktivní 3D model' );
		$variant = $frame->expand( $args['variant'] ?? $args['varianta'] ?? $args['zobrazení'] ?? $args['zobrazeni'] ?? 'small' );
		$awaitLoad = $frame->expand( $args['await-load'] ?? $args['awaitLoad'] ?? $args['načíst-po-kliknutí'] ?? $args['nacist-po-kliknuti'] ?? 'ano' );
		return self::viewerEmbed( $article, $height, $title, $variant, $awaitLoad, $parser );
	}

	/** Function hooks are used by templates because parser-tag attributes are stripped before {{{parameters}}} expand. */
	public static function renderModel3dFunction( Parser $parser, string $article = '', string $height = '560', string $title = 'Interaktivní 3D model', string $variant = 'small', string $awaitLoad = 'ano' ): array {
		if ( trim( $article ) === '' ) {
			return [ '<span class="error">Chybí parametr model pro 3D prohlížeč.</span>', 'isHTML' => true, 'noparse' => true ];
		}
		return self::viewerEmbed( trim( $article ), $height, $title, $variant, $awaitLoad, $parser );
	}

	private static function viewerEmbed( string $article, string $height, string $title, string $variant, string $awaitLoad, Parser $parser ): array {
		$height = max( 260, min( 1000, intval( $height ) ) );
		$title = trim( $title ) ?: 'Interaktivní 3D model';
		$url = self::viewerUrl( $article, $parser, true, $variant, self::shouldAwaitLoad( $awaitLoad ) );
		$html = Html::rawElement(
			'figure',
			[ 'class' => 'model3d-embed', 'data-model3d-article' => $article, 'style' => "margin:1em 0;max-width:100%;" ],
			Html::element( 'iframe', [
				'src' => $url,
				'title' => $title,
				'loading' => 'lazy',
				'allow' => 'fullscreen',
				'allowfullscreen' => 'true',
				'style' => "display:block;width:100%;height:{$height}px;min-height:320px;border:1px solid #c8d4da;border-radius:6px;background:#f7fafc;"
			] )
		);
		return [ $html, 'isHTML' => true, 'noparse' => true ];
	}

	public static function renderModel3dLink( ?string $input, array $args, Parser $parser, PPFrame $frame ): array {
		$article = trim( $frame->expand( $args['article'] ?? '' ) );
		if ( $article === '' ) {
			return [ '<span class="error">Chybí parametr article pro 3D odkaz.</span>', 'isHTML' => true, 'noparse' => true ];
		}
		$text = $frame->expand( $args['text'] ?? $args['popisek'] ?? 'Otevřít interaktivní 3D prohlížeč' );
		return self::viewerLink( $article, $text, $parser );
	}

	public static function renderModel3dLinkFunction( Parser $parser, string $article = '', string $text = 'Otevřít interaktivní 3D prohlížeč' ): array {
		if ( trim( $article ) === '' ) {
			return [ '<span class="error">Chybí parametr model pro 3D odkaz.</span>', 'isHTML' => true, 'noparse' => true ];
		}
		return self::viewerLink( trim( $article ), $text, $parser );
	}

	private static function viewerLink( string $article, string $text, Parser $parser ): array {
		$text = trim( $text ) ?: 'Otevřít interaktivní 3D prohlížeč';
		return [
			Html::rawElement(
				'a',
				[ 'href' => self::viewerUrl( $article, $parser, false ), 'target' => '_blank', 'rel' => 'noopener noreferrer', 'class' => 'model3d-link' ],
				Html::element( 'span', [ 'class' => 'model3d-link-text' ], $text ) . self::viewerLinkIcon()
			),
			'isHTML' => true,
			'noparse' => true
		];
	}

	/** Decorative inline SVG keeps the icon available without a wiki file or ResourceLoader module. */
	private static function viewerLinkIcon(): string {
		return Html::rawElement(
			'svg',
			[
				'class' => 'model3d-link-icon',
				'xmlns' => 'http://www.w3.org/2000/svg',
				'viewBox' => '0 0 32 32',
				'width' => '15',
				'height' => '15',
				'aria-hidden' => 'true',
				'focusable' => 'false',
				'style' => 'display:inline-block;width:15px;height:15px;margin-left:.25rem;vertical-align:middle;'
			],
			'<path fill="#68c7f2" d="m16 15.5 13-7v14l-13 7z"/>' .
			'<path fill="#2c83c5" d="m16 15.5 13 7-13 7z"/>' .
			'<path fill="#7b5bc7" d="m3 8.5 13 7v14L3 22.5z"/>' .
			'<path fill="#a68ae2" d="m3 8.5 13 7v14L3 22.5z" opacity=".45"/>' .
			'<path fill="#ffd66b" d="M16 1.5 29 8.5l-13 7-13-7z"/>' .
			'<path fill="#f6b73c" d="m16 1.5 13 7-13 7z" opacity=".55"/>' .
			'<path fill="none" stroke="#4c3a7c" stroke-linejoin="round" stroke-width="1.2" d="m3 8.5 13 7 13-7M16 15.5v14M3 8.5v14l13 7 13-7v-14l-13-7z"/>'
		);
	}

	/** The category page is intentionally data-only; the viewer writes and reads its JSON body. */
	public static function renderCategoryStore( ?string $input, array $args, Parser $parser, PPFrame $frame ): array {
		return [
			Html::rawElement( 'span', [ 'class' => 'model3d-data-note' ], 'Sdílené kategorie popisků pro 3D modely.' ),
			'isHTML' => true,
			'noparse' => true
		];
	}

	private static function viewerUrl( string $article, Parser $parser, bool $embed, string $variant = 'small', bool $awaitLoad = true ): string {
		global $wgThreeDViewerUrl;
		$base = (string)$wgThreeDViewerUrl;
		$separator = strpos( $base, '?' ) === false ? '?' : '&';
		$returnTo = $parser->getTitle()->getFullURL();
		$query = [ 'article' => $article, 'returnTo' => $returnTo ];
		if ( $embed ) {
			$query['embed'] = '1';
			$query['variant'] = self::normalizeVariant( $variant );
			$query['awaitLoad'] = $awaitLoad ? '1' : '0';
		}
		return $base . $separator . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 );
	}

	private static function normalizeVariant( string $variant ): string {
		$value = strtolower( trim( $variant ) );
		if ( in_array( $value, [ 'medium', 'm', 'stredni', 'střední' ], true ) ) {
			return 'medium';
		}
		if ( in_array( $value, [ 'original', 'orig', 'o', 'puvodni', 'původní' ], true ) ) {
			return 'original';
		}
		return 'small';
	}

	/** The confirmation gate is on by default; common negative values disable it. */
	private static function shouldAwaitLoad( string $value ): bool {
		$value = strtolower( trim( $value ) );
		return !in_array( $value, [ '0', 'false', 'ne', 'no', 'off', 'vypnuto' ], true );
	}
}
