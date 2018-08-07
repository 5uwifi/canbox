# keep track of dirs
# standard NR-make boilerplate, to be included at the beginning of a file
p := $(sp).x
dirstack_$(sp) := $(d)
$(warning dir: $(dir))
$(warning sp: $(sp))
d := $(dir)
