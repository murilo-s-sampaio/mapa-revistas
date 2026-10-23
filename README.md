# Mapa de Revistas

Página estática: você escreve palavras-chave e vê as revistas que publicaram sobre elas, com o impacto em dois anos e a
classificação Qualis CAPES. Cada revista é um ponto: o eixo horizontal é em quantas das palavras-chave ela publica, o
eixo vertical é o impacto e a cor é o estrato Qualis, que pode ser filtrado (A1, A2, A3…).

## Como funciona

- **Revistas por palavra-chave:** consulta ao vivo da [OpenAlex](https://openalex.org) (gratuita, sem chave), pela frase
  exata no título ou no resumo dos artigos, desde o ano escolhido. Uma revista "publica sobre" uma palavra-chave quando
  tem pelo menos um artigo com a frase; dentro de cada faixa do eixo horizontal, a posição é o total de artigos sobre os
  temas.
- **Impacto em dois anos:** `2yr_mean_citedness` da OpenAlex, a média de citações dos artigos publicados nos dois anos
  anteriores (a mesma ideia do fator de impacto do JCR, em outra base; costuma dar valores um pouco maiores).
- **Qualis:** `data/qualis.json`, gerado a partir da consulta pública de classificações de periódicos da Plataforma
  Sucupira (quadriênio 2021–2024), uma entrada por ISSN. A revista da OpenAlex é ligada ao Qualis pelo ISSN.

## Publicar no GitHub Pages

1. Crie um repositório (por exemplo `mapa-revistas`) e envie `index.html`, `app.js`, `data/qualis.json` e este README.
2. Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. A página fica em `https://<seu-usuario>.github.io/mapa-revistas/`.

Links de busca podem ser compartilhados: a URL guarda as palavras-chave, o número de revistas, o ano inicial e os
estratos marcados.

## Atualizar o Qualis

Os scripts de download ficam em `tools/` (`scrape_qualis.py`, que usa Playwright com o Chrome, e `build_qualis_json.py`). Rode o download e gere de novo
`data/qualis.json` quando a CAPES publicar uma nova classificação.
