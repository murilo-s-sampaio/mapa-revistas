# Mapa de Revistas

Página estática para escolher revistas: você escreve palavras-chave de escopo e cada revista que combina com pelo menos
uma vira um ponto. O eixo horizontal é o número de palavras-chave que combinam com a revista (1, 2, 3…), o vertical é o
impacto e a cor é o estrato Qualis CAPES. Dá para filtrar por estrato (A1, A2, A3…) e por acesso aberto ou híbrida.

Página: https://murilo-s-sampaio.github.io/mapa-revistas/

## Dados (tudo baixado, sem consulta externa)

- `data/scimago.json`: todas as revistas do [SCImago Journal & Country Rank](https://www.scimagojr.com) (base Scopus):
  nome, ISSN, SJR, quartil, índice h, citações por documento em 2 anos, citações por artigo em 3 anos, acesso aberto,
  editora, categorias e áreas.
- `data/qualis.json`: classificação Qualis do quadriênio 2021–2024, da consulta pública da
  [Plataforma Sucupira](https://sucupira.capes.gov.br), uma entrada por ISSN.

Uma palavra-chave combina com a revista quando aparece no nome dela ou nas suas categorias e áreas do Scopus (sem
diferenciar maiúsculas e acentos). A lista de categorias aparece na página para clicar e acrescentar.

O fator de impacto do JCR (Clarivate) não é aberto. A métrica padrão, citações por artigo em 3 anos (citações recebidas no
ano pelos artigos e revisões dos três anos anteriores, por documento), é a mais próxima dele, mas não coincide com o JCR.

## Atualizar as tabelas

Scripts em `tools/` (rodam em Python com Playwright e o Chrome instalado):

1. `scrape_qualis.py`: baixa a classificação Qualis do Sucupira, estrato por estrato.
2. `build_qualis_json.py`: gera `data/qualis.json` a partir do download.
3. Exporte a tabela do SCImago (journalrank.php?out=xls) e rode `build_scimago_json.py scimago.csv data/scimago.json`.

Depois de trocar os arquivos de dados, aumente `DATA_VERSION` em `app.js` e o `?v=` em `index.html` para os navegadores
buscarem a versão nova.

## Publicar no GitHub Pages

Em **Settings → Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
