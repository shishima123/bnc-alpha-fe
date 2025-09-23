.PHONY: build deploy

build:
	rm -rf dist
	yarn build

deploy: build
	cd dist && \
	git init && \
	git add -A && \
	git commit -m 'deploy' && \
	git push -f https://github.com/shishima123/bnc-alpha-fe.git master:gh-pages && \
	cd -