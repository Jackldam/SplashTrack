using System.ComponentModel.DataAnnotations;

namespace SplashTrackWebApp.Models
{
    public class UserCreateViewModel
    {
        [Required]
        [StringLength(100)]
        [Display(Name = "First Name")]
        public required string FirstName { get; set; }

        [StringLength(100)]
        [Display(Name = "Middle Name")]
        public string? MiddleName { get; set; }

        [Required]
        [StringLength(100)]
        [Display(Name = "Last Name")]
        public required string LastName { get; set; }

        [Required]
        [Display(Name = "Date of Birth")]
        public required DateOnly DateOfBirth { get; set; }

        [Required]
        [EmailAddress]
        [Display(Name = "Email")]
        public required string Email { get; set; }

        [Required]
        [StringLength(256, MinimumLength = 3)]
        [Display(Name = "Username")]
        public required string UserName { get; set; }

        [Required]
        [StringLength(100, MinimumLength = 6)]
        [DataType(DataType.Password)]
        [Display(Name = "Password")]
        public required string Password { get; set; }

        [DataType(DataType.Password)]
        [Display(Name = "Confirm Password")]
        [Compare("Password", ErrorMessage = "The password and confirmation password do not match.")]
        public required string ConfirmPassword { get; set; }
    }

    public class UserEditViewModel
    {
        public required string Id { get; set; }

        [Required]
        [StringLength(100)]
        [Display(Name = "First Name")]
        public required string FirstName { get; set; }

        [StringLength(100)]
        [Display(Name = "Middle Name")]
        public string? MiddleName { get; set; }

        [Required]
        [StringLength(100)]
        [Display(Name = "Last Name")]
        public required string LastName { get; set; }

        [Required]
        [Display(Name = "Date of Birth")]
        public required DateOnly DateOfBirth { get; set; }

        [Required]
        [EmailAddress]
        [Display(Name = "Email")]
        public required string Email { get; set; }

        [Required]
        [StringLength(256, MinimumLength = 3)]
        [Display(Name = "Username")]
        public required string UserName { get; set; }
    }
}
