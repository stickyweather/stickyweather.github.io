module Jekyll
  module StaticComments
    class StaticCommentsGenerator < Jekyll::Generator
      safe true
      priority :high

      def generate(site)
        site.posts.docs.each do |post|
          post.data['comments'] = read_comments(site, post)
        end
      end

      def read_comments(site, post)
        comments = []
        
        # Get the slug from the post
        slug = post.basename_without_ext
        
        # Look for comment files
        comment_dir = File.join(site.source, '_comments', slug)
        
        if Dir.exist?(comment_dir)
          Dir.foreach(comment_dir) do |filename|
            next if filename.start_with?('.')
            
            comment_path = File.join(comment_dir, filename)
            next unless File.file?(comment_path)
            
            # Read and parse the comment YAML
            comment_data = YAML.load_file(comment_path)
            comments << comment_data if comment_data
          end
        end
        
        # Sort comments by date
        comments.sort_by { |c| c['date'] || '' }
      end
    end
  end
end